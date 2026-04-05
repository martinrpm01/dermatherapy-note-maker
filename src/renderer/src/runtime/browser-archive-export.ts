import JSZip from "jszip";

import {
  PATIENT_ARCHIVE_FORMAT_VERSION,
  type ArchiveAssetDescriptor,
  type PatientArchivePreparationWarning,
  type PreparedPatientArchiveDescription
} from "../../../shared/archive";
import type {
  AssetReference,
  GeneratedPdfRecord,
  VisitAttachmentRecord,
  VisitPhotoRecord
} from "../../../shared/types";
import { BrowserBinaryAssetStore } from "../storage/browser-binary-asset-store";
import { BrowserStructuredDataStore } from "../storage/browser-structured-data-store";

export interface BrowserArchiveExportPayload {
  patientId: string;
  fileName: string;
  bytes: Uint8Array;
  includedAssetCount: number;
  missingAssetCount: number;
  warnings: PatientArchivePreparationWarning[];
}

function sanitizeNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "");
}

function exportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function joinPosix(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/g, "");
      }
      return part.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}

function getExtension(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const lastSlash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const fileName = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex) : "";
}

function fallbackExtFromKind(kind: AssetReference["kind"]) {
  if (kind === "generated_pdf") {
    return ".pdf";
  }
  return "";
}

function extForAsset(asset: AssetReference, storedPath: string | null, originalName?: string | null) {
  const explicit = getExtension(originalName);
  if (explicit) {
    return explicit;
  }

  const fromPath = getExtension(storedPath);
  if (fromPath) {
    return fromPath;
  }

  return fallbackExtFromKind(asset.kind);
}

function buildArchiveFileName(description: PreparedPatientArchiveDescription) {
  const identity = description.manifest.patientIdentity;
  const patientName = sanitizeNamePart(`${identity.lastName}-${identity.firstName}`) || description.manifest.patientId;
  const mrn = sanitizeNamePart(identity.mrn) || "no-mrn";
  return `${patientName}-${mrn}-patient-archive-${exportTimestamp()}.zip`;
}

function buildDescriptor(input: {
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
  availableLocally: boolean;
}): ArchiveAssetDescriptor {
  return {
    asset: input.asset,
    category: input.asset.kind,
    recordType: input.recordType,
    recordId: input.recordId,
    patientId: input.patientId,
    courseId: input.courseId,
    visitNoteId: input.visitNoteId,
    packagePath: input.packagePath,
    fileName: input.packagePath.slice(input.packagePath.lastIndexOf("/") + 1),
    mimeType: input.mimeType,
    originalName: input.originalName,
    caption: input.caption,
    sortOrder: input.sortOrder,
    versionNumber: input.versionNumber,
    availableLocally: input.availableLocally
  };
}

function buildPatientFacePackagePath(patientId: string, asset: AssetReference, storedPath: string | null) {
  const extension = extForAsset(asset, storedPath, null);
  return joinPosix("files", "patients", patientId, `face-photo${extension}`);
}

function buildVisitPhotoPackagePath(photo: VisitPhotoRecord, storedPath: string | null) {
  const extension = extForAsset(photo.imageAsset, storedPath, null);
  return joinPosix("files", "visits", photo.visitNoteId, "photos", `${String(photo.sortOrder).padStart(2, "0")}-visit-photo${extension}`);
}

function buildVisitAttachmentPackagePath(attachment: VisitAttachmentRecord, storedPath: string | null) {
  const extension = extForAsset(attachment.fileAsset, storedPath, attachment.originalName);
  const baseName = attachment.originalName
    ? attachment.originalName.slice(0, attachment.originalName.length - getExtension(attachment.originalName).length)
    : `attachment-${attachment.sortOrder}`;
  const fileName = `${String(attachment.sortOrder).padStart(2, "0")}-${sanitizeFileName(baseName) || "attachment"}${extension}`;
  return joinPosix("files", "visits", attachment.visitNoteId, "attachments", fileName);
}

function buildGeneratedPdfPackagePath(pdf: GeneratedPdfRecord, storedPath: string | null) {
  const extension = extForAsset(pdf.fileAsset, storedPath, null) || ".pdf";
  return joinPosix("files", "visits", pdf.visitNoteId, "pdfs", `generated-pdf-v${pdf.versionNumber}${extension}`);
}

export async function exportPatientArchiveFromBrowserStores(
  patientId: string,
  repository: BrowserStructuredDataStore,
  assetStore: BrowserBinaryAssetStore
): Promise<BrowserArchiveExportPayload> {
  await repository.initialize();
  await assetStore.ready();

  const detail = repository.loadPatientDetails([patientId])[0];
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
    const storedPath = assetStore.getStoredPath(detail.patient.facePhoto.assetId);
    pushDescriptor(
      buildDescriptor({
        asset: detail.patient.facePhoto,
        recordType: "patient",
        recordId: detail.patient.id,
        patientId: detail.patient.id,
        courseId: null,
        visitNoteId: null,
        packagePath: buildPatientFacePackagePath(detail.patient.id, detail.patient.facePhoto, storedPath),
        mimeType: null,
        originalName: null,
        caption: null,
        sortOrder: null,
        versionNumber: null,
        availableLocally: Boolean(assetStore.getStoredBlob(detail.patient.facePhoto.assetId))
      })
    );
  }

  const visitById = new Map(visitNotes.map((note) => [note.id, note]));

  for (const photo of visitPhotos) {
    const storedPath = assetStore.getStoredPath(photo.imageAsset.assetId);
    const visit = visitById.get(photo.visitNoteId);
    pushDescriptor(
      buildDescriptor({
        asset: photo.imageAsset,
        recordType: "visit_photo",
        recordId: photo.id,
        patientId: detail.patient.id,
        courseId: visit?.courseId ?? null,
        visitNoteId: photo.visitNoteId,
        packagePath: buildVisitPhotoPackagePath(photo, storedPath),
        mimeType: null,
        originalName: null,
        caption: photo.caption || null,
        sortOrder: photo.sortOrder,
        versionNumber: null,
        availableLocally: Boolean(assetStore.getStoredBlob(photo.imageAsset.assetId))
      })
    );
  }

  for (const attachment of visitAttachments) {
    const storedPath = assetStore.getStoredPath(attachment.fileAsset.assetId);
    const visit = visitById.get(attachment.visitNoteId);
    pushDescriptor(
      buildDescriptor({
        asset: attachment.fileAsset,
        recordType: "visit_attachment",
        recordId: attachment.id,
        patientId: detail.patient.id,
        courseId: visit?.courseId ?? null,
        visitNoteId: attachment.visitNoteId,
        packagePath: buildVisitAttachmentPackagePath(attachment, storedPath),
        mimeType: attachment.mimeType || null,
        originalName: attachment.originalName || null,
        caption: attachment.caption || null,
        sortOrder: attachment.sortOrder,
        versionNumber: null,
        availableLocally: Boolean(assetStore.getStoredBlob(attachment.fileAsset.assetId))
      })
    );
  }

  for (const pdf of generatedPdfs) {
    const storedPath = assetStore.getStoredPath(pdf.fileAsset.assetId);
    const visit = visitById.get(pdf.visitNoteId);
    pushDescriptor(
      buildDescriptor({
        asset: pdf.fileAsset,
        recordType: "generated_pdf",
        recordId: pdf.id,
        patientId: detail.patient.id,
        courseId: visit?.courseId ?? null,
        visitNoteId: pdf.visitNoteId,
        packagePath: buildGeneratedPdfPackagePath(pdf, storedPath),
        mimeType: "application/pdf",
        originalName: null,
        caption: null,
        sortOrder: null,
        versionNumber: pdf.versionNumber,
        availableLocally: Boolean(assetStore.getStoredBlob(pdf.fileAsset.assetId))
      })
    );
  }

  const description: PreparedPatientArchiveDescription = {
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

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(description.manifest, null, 2));
  zip.file("patient.json", JSON.stringify(description.payload.patient, null, 2));
  zip.file("courses.json", JSON.stringify(description.payload.courses, null, 2));
  zip.file("sites.json", JSON.stringify(description.payload.sites, null, 2));
  zip.file("visit-notes.json", JSON.stringify(description.payload.visitNotes, null, 2));
  zip.file("visit-photos.json", JSON.stringify(description.payload.visitPhotos, null, 2));
  zip.file("visit-attachments.json", JSON.stringify(description.payload.visitAttachments, null, 2));
  zip.file("generated-pdfs.json", JSON.stringify(description.payload.generatedPdfs, null, 2));
  zip.file("asset-descriptors.json", JSON.stringify(description.assets, null, 2));
  zip.file("warnings.json", JSON.stringify(description.warnings, null, 2));

  let includedAssetCount = 0;
  for (const descriptor of description.assets) {
    const blob = assetStore.getStoredBlob(descriptor.asset.assetId);
    if (!blob) {
      continue;
    }

    zip.file(descriptor.packagePath, await blob.arrayBuffer());
    includedAssetCount += 1;
  }

  return {
    patientId: description.manifest.patientId,
    fileName: buildArchiveFileName(description),
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    includedAssetCount,
    missingAssetCount: description.warnings.length,
    warnings: description.warnings
  };
}
