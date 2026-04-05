import fs from "node:fs";
import path from "node:path";

import {
  PATIENT_ARCHIVE_FORMAT_VERSION,
  type ArchiveAssetDescriptor,
  type PatientArchivePreparationWarning,
  type PreparedPatientArchiveDescription
} from "../shared/archive";
import type { AssetReference, GeneratedPdfRecord, VisitAttachmentRecord, VisitPhotoRecord } from "../shared/types";
import type { BinaryAssetStore, StructuredDataStore } from "../shared/storage";

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "");
}

function fallbackExtFromKind(kind: AssetReference["kind"]) {
  if (kind === "generated_pdf") {
    return ".pdf";
  }
  return "";
}

function extForAsset(asset: AssetReference, resolvedPath: string | null, originalName?: string | null) {
  const explicit = originalName ? path.extname(originalName) : "";
  if (explicit) {
    return explicit;
  }

  if (resolvedPath) {
    const resolvedExt = path.extname(resolvedPath);
    if (resolvedExt) {
      return resolvedExt;
    }
  }

  return fallbackExtFromKind(asset.kind);
}

export class PatientArchivePreparationService {
  constructor(
    private readonly repository: StructuredDataStore,
    private readonly assetStore: BinaryAssetStore
  ) {}

  preparePatientArchive(patientId: string): PreparedPatientArchiveDescription {
    const detail = this.repository.loadPatientDetails([patientId])[0];
    if (!detail) {
      throw new Error("Patient not found.");
    }

    const courses = detail.courses.map((courseDetail) => courseDetail.course);
    const sites = detail.courses.flatMap((courseDetail) => courseDetail.sites);
    const visitBundles = detail.courses.flatMap((courseDetail) => courseDetail.visits);
    const visitNotes = visitBundles.map((visit) => visit.note);
    const visitPhotos = visitBundles.flatMap((visit) => visit.photos);
    const visitAttachments = visitBundles.flatMap((visit) => visit.attachments);
    const generatedPdfs = visitBundles.flatMap((visit) => visit.pdfs);

    const warnings: PatientArchivePreparationWarning[] = [];
    const assets: ArchiveAssetDescriptor[] = [];

    const pushDescriptor = (descriptor: ArchiveAssetDescriptor) => {
      assets.push(descriptor);
      if (!descriptor.availableLocally) {
        warnings.push({
          code: "missing_asset_file",
          message: `Asset file for ${descriptor.recordType} ${descriptor.recordId} is not available locally.`,
          assetId: descriptor.asset.assetId,
          recordId: descriptor.recordId
        });
      }
    };

    if (detail.patient.facePhoto) {
      pushDescriptor(
        this.buildDescriptor({
          asset: detail.patient.facePhoto,
          recordType: "patient",
          recordId: detail.patient.id,
          patientId: detail.patient.id,
          courseId: null,
          visitNoteId: null,
          caption: null,
          originalName: null,
          mimeType: null,
          sortOrder: null,
          versionNumber: null,
          packagePath: this.buildPatientFacePackagePath(detail.patient.id, detail.patient.facePhoto)
        })
      );
    }

    const visitById = new Map(visitNotes.map((note) => [note.id, note]));

    for (const photo of visitPhotos) {
      const visit = visitById.get(photo.visitNoteId);
      pushDescriptor(
        this.buildDescriptor({
          asset: photo.imageAsset,
          recordType: "visit_photo",
          recordId: photo.id,
          patientId: detail.patient.id,
          courseId: visit?.courseId ?? null,
          visitNoteId: photo.visitNoteId,
          caption: photo.caption || null,
          originalName: null,
          mimeType: null,
          sortOrder: photo.sortOrder,
          versionNumber: null,
          packagePath: this.buildVisitPhotoPackagePath(photo)
        })
      );
    }

    for (const attachment of visitAttachments) {
      const visit = visitById.get(attachment.visitNoteId);
      pushDescriptor(
        this.buildDescriptor({
          asset: attachment.fileAsset,
          recordType: "visit_attachment",
          recordId: attachment.id,
          patientId: detail.patient.id,
          courseId: visit?.courseId ?? null,
          visitNoteId: attachment.visitNoteId,
          caption: attachment.caption || null,
          originalName: attachment.originalName || null,
          mimeType: attachment.mimeType || null,
          sortOrder: attachment.sortOrder,
          versionNumber: null,
          packagePath: this.buildVisitAttachmentPackagePath(attachment)
        })
      );
    }

    for (const pdf of generatedPdfs) {
      const visit = visitById.get(pdf.visitNoteId);
      pushDescriptor(
        this.buildDescriptor({
          asset: pdf.fileAsset,
          recordType: "generated_pdf",
          recordId: pdf.id,
          patientId: detail.patient.id,
          courseId: visit?.courseId ?? null,
          visitNoteId: pdf.visitNoteId,
          caption: null,
          originalName: null,
          mimeType: "application/pdf",
          sortOrder: null,
          versionNumber: pdf.versionNumber,
          packagePath: this.buildGeneratedPdfPackagePath(pdf)
        })
      );
    }

    return {
      manifest: {
        archiveType: "patient_archive",
        archiveVersion: PATIENT_ARCHIVE_FORMAT_VERSION,
        preparedAt: new Date().toISOString(),
        patientId: detail.patient.id,
        patientIdentity: {
          firstName: detail.patient.firstName,
          lastName: detail.patient.lastName,
          mrn: detail.patient.mrn,
          dob: detail.patient.dob
        },
        patientStatusAtExport: detail.patient.status,
        suggestedRestoreBucket: "completed_patients",
        recordCounts: {
          courses: courses.length,
          sites: sites.length,
          visitNotes: visitNotes.length,
          visitPhotos: visitPhotos.length,
          visitAttachments: visitAttachments.length,
          generatedPdfs: generatedPdfs.length
        },
        assetCounts: {
          patient_face_photo: detail.patient.facePhoto ? 1 : 0,
          visit_photo: visitPhotos.length,
          visit_attachment: visitAttachments.length,
          generated_pdf: generatedPdfs.length,
          settings_logo: 0
        }
      },
      payload: {
        patient: detail.patient,
        courses,
        sites,
        visitNotes,
        visitPhotos,
        visitAttachments,
        generatedPdfs
      },
      assets,
      warnings
    };
  }

  private buildDescriptor(input: {
    asset: AssetReference;
    recordType: ArchiveAssetDescriptor["recordType"];
    recordId: string;
    patientId: string;
    courseId: string | null;
    visitNoteId: string | null;
    packagePath: string;
    mimeType: string | null;
    originalName: string | null;
    caption: string | null;
    sortOrder: number | null;
    versionNumber: number | null;
  }): ArchiveAssetDescriptor {
    const resolvedPath = this.assetStore.resolveAssetPath(input.asset);
    const availableLocally = Boolean(resolvedPath && fs.existsSync(resolvedPath));

    return {
      asset: input.asset,
      category: input.asset.kind,
      recordType: input.recordType,
      recordId: input.recordId,
      patientId: input.patientId,
      courseId: input.courseId,
      visitNoteId: input.visitNoteId,
      packagePath: input.packagePath,
      fileName: path.basename(input.packagePath),
      mimeType: input.mimeType,
      originalName: input.originalName,
      caption: input.caption,
      sortOrder: input.sortOrder,
      versionNumber: input.versionNumber,
      availableLocally
    };
  }

  private buildPatientFacePackagePath(patientId: string, asset: AssetReference) {
    const resolvedPath = this.assetStore.resolveAssetPath(asset);
    const extension = extForAsset(asset, resolvedPath, null);
    return path.posix.join("files", "patients", patientId, `face-photo${extension}`);
  }

  private buildVisitPhotoPackagePath(photo: VisitPhotoRecord) {
    const resolvedPath = this.assetStore.resolveAssetPath(photo.imageAsset);
    const extension = extForAsset(photo.imageAsset, resolvedPath, null);
    const fileName = `${String(photo.sortOrder).padStart(2, "0")}-visit-photo${extension}`;
    return path.posix.join("files", "visits", photo.visitNoteId, "photos", fileName);
  }

  private buildVisitAttachmentPackagePath(attachment: VisitAttachmentRecord) {
    const resolvedPath = this.assetStore.resolveAssetPath(attachment.fileAsset);
    const extension = extForAsset(attachment.fileAsset, resolvedPath, attachment.originalName);
    const baseName = attachment.originalName
      ? path.basename(attachment.originalName, path.extname(attachment.originalName))
      : `attachment-${attachment.sortOrder}`;
    const fileName = `${String(attachment.sortOrder).padStart(2, "0")}-${sanitizeFileName(baseName) || "attachment"}${extension}`;
    return path.posix.join("files", "visits", attachment.visitNoteId, "attachments", fileName);
  }

  private buildGeneratedPdfPackagePath(pdf: GeneratedPdfRecord) {
    const resolvedPath = this.assetStore.resolveAssetPath(pdf.fileAsset);
    const extension = extForAsset(pdf.fileAsset, resolvedPath, null) || ".pdf";
    const fileName = `generated-pdf-v${pdf.versionNumber}${extension}`;
    return path.posix.join("files", "visits", pdf.visitNoteId, "pdfs", fileName);
  }
}
