import JSZip from "jszip";

import type {
  ArchiveAssetDescriptor,
  ImportedPatientArchiveDescription,
  PatientArchivePreflightResult,
  PatientArchiveReadResult,
  PatientArchiveRestoreBlocker,
  PatientArchiveRestoreMode,
  PatientArchiveRestoreResult
} from "../../../shared/archive";
import type {
  CourseInput,
  AssetReference,
  GeneratedPdfRecord,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteInput,
  VisitAttachmentRecord,
  VisitInput,
  VisitNoteRecord,
  VisitPhotoRecord
} from "../../../shared/types";
import type { BinaryAssetStore, StructuredDataStore } from "../../../shared/storage";
import type { BrowserStructuredDataStore } from "../storage/browser-structured-data-store";

type BrowserBinaryAssetStoreLike = BinaryAssetStore & {
  ready(): Promise<void>;
  flush(): Promise<void>;
  registerStoredAssetReference(asset: AssetReference, filePath: string, blob: Blob): AssetReference;
};

function normalizeIdentityPart(value: string) {
  return value.trim().toLowerCase();
}

function buildIdentityKey(patient: Pick<PatientRecord, "firstName" | "lastName" | "mrn" | "dob">) {
  return [
    normalizeIdentityPart(patient.firstName),
    normalizeIdentityPart(patient.lastName),
    normalizeIdentityPart(patient.mrn),
    patient.dob
  ].join("|");
}

function buildDeterministicId(prefix: string, seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(16).padStart(8, "0")}`;
}

type RestorePlan = {
  mode: PatientArchiveRestoreMode;
  canonicalPatient: PatientRecord;
  patientInput: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    dob: string;
    sex: string;
    notes: string;
  };
  importedFaceDescriptor: ArchiveAssetDescriptor | null;
  shouldApplyImportedFacePhoto: boolean;
  notices: string[];
  courses: TreatmentCourseRecord[];
  sites: Array<TreatmentSiteInput & { id: string; courseId: string }>;
  visits: VisitNoteRecord[];
  visitPhotos: VisitPhotoRecord[];
  visitAttachments: VisitAttachmentRecord[];
  generatedPdfs: GeneratedPdfRecord[];
  sourceRecordIds: {
    visitPhotos: Map<string, string>;
    visitAttachments: Map<string, string>;
    generatedPdfs: Map<string, string>;
  };
};

function buildRestorePlan(repository: StructuredDataStore, archive: ImportedPatientArchiveDescription): RestorePlan {
  const importedPatient = archive.payload.patient;
  const identityMatches = repository
    .fetchPatients("1 = 1", [])
    .filter((patient) => buildIdentityKey(patient) === buildIdentityKey(importedPatient));

  const importedFaceDescriptor =
    archive.assets.find(
      (asset) => asset.recordType === "patient" && asset.recordId === importedPatient.id && asset.category === "patient_face_photo"
    ) ?? null;

  if (!identityMatches.length) {
    return {
      mode: "new_patient",
      canonicalPatient: importedPatient,
      patientInput: {
        id: importedPatient.id,
        firstName: importedPatient.firstName,
        lastName: importedPatient.lastName,
        mrn: importedPatient.mrn,
        dob: importedPatient.dob,
        sex: importedPatient.sex,
        notes: importedPatient.notes
      },
      importedFaceDescriptor,
      shouldApplyImportedFacePhoto: Boolean(importedFaceDescriptor),
      notices: [],
      courses: archive.payload.courses,
      sites: archive.payload.sites.map((site) => ({ ...site })),
      visits: archive.payload.visitNotes,
      visitPhotos: archive.payload.visitPhotos,
      visitAttachments: archive.payload.visitAttachments,
      generatedPdfs: archive.payload.generatedPdfs,
      sourceRecordIds: {
        visitPhotos: new Map(archive.payload.visitPhotos.map((photo) => [photo.id, photo.id])),
        visitAttachments: new Map(archive.payload.visitAttachments.map((attachment) => [attachment.id, attachment.id])),
        generatedPdfs: new Map(archive.payload.generatedPdfs.map((pdf) => [pdf.id, pdf.id]))
      }
    };
  }

  const canonicalPatient = identityMatches[0]!;
  const notices: string[] = [
    `Merged imported archive into existing patient ${canonicalPatient.id} based on matching name, DOB, and MRN.`
  ];

  if (canonicalPatient.facePhoto && importedFaceDescriptor) {
    notices.push("Existing local patient face photo was preserved; imported archive face photo was not applied.");
  }

  const remapSuffix = canonicalPatient.id;
  const courseIdMap = new Map<string, string>();
  const siteIdMap = new Map<string, string>();
  const visitIdMap = new Map<string, string>();
  const photoIdMap = new Map<string, string>();
  const attachmentIdMap = new Map<string, string>();
  const pdfIdMap = new Map<string, string>();

  for (const course of archive.payload.courses) {
    courseIdMap.set(course.id, buildDeterministicId("course", `${remapSuffix}:${course.id}`));
  }
  for (const site of archive.payload.sites) {
    siteIdMap.set(site.id, buildDeterministicId("site", `${remapSuffix}:${site.id}`));
  }
  for (const visit of archive.payload.visitNotes) {
    visitIdMap.set(visit.id, buildDeterministicId("visit", `${remapSuffix}:${visit.id}`));
  }
  for (const photo of archive.payload.visitPhotos) {
    photoIdMap.set(photo.id, buildDeterministicId("photo", `${remapSuffix}:${photo.id}`));
  }
  for (const attachment of archive.payload.visitAttachments) {
    attachmentIdMap.set(attachment.id, buildDeterministicId("attachment", `${remapSuffix}:${attachment.id}`));
  }
  for (const pdf of archive.payload.generatedPdfs) {
    pdfIdMap.set(pdf.id, buildDeterministicId("pdf", `${remapSuffix}:${pdf.id}`));
  }

  return {
    mode: "merge_existing_patient",
    canonicalPatient,
    patientInput: {
      id: canonicalPatient.id,
      firstName: canonicalPatient.firstName,
      lastName: canonicalPatient.lastName,
      mrn: canonicalPatient.mrn,
      dob: canonicalPatient.dob,
      sex: canonicalPatient.sex,
      notes: canonicalPatient.notes
    },
    importedFaceDescriptor,
    shouldApplyImportedFacePhoto: !canonicalPatient.facePhoto && Boolean(importedFaceDescriptor),
    notices,
    courses: archive.payload.courses.map((course) => ({
      ...course,
      id: courseIdMap.get(course.id)!,
      patientId: canonicalPatient.id
    })),
    sites: archive.payload.sites.map((site) => ({
      ...site,
      id: siteIdMap.get(site.id)!,
      courseId: courseIdMap.get(site.courseId)!
    })),
    visits: archive.payload.visitNotes.map((visit) => ({
      ...visit,
      id: visitIdMap.get(visit.id)!,
      patientId: canonicalPatient.id,
      courseId: courseIdMap.get(visit.courseId)!,
      pdfAsset: null
    })),
    visitPhotos: archive.payload.visitPhotos.map((photo) => ({
      ...photo,
      id: photoIdMap.get(photo.id)!,
      visitNoteId: visitIdMap.get(photo.visitNoteId)!
    })),
    visitAttachments: archive.payload.visitAttachments.map((attachment) => ({
      ...attachment,
      id: attachmentIdMap.get(attachment.id)!,
      visitNoteId: visitIdMap.get(attachment.visitNoteId)!
    })),
    generatedPdfs: archive.payload.generatedPdfs.map((pdf) => ({
      ...pdf,
      id: pdfIdMap.get(pdf.id)!,
      visitNoteId: visitIdMap.get(pdf.visitNoteId)!
    })),
    sourceRecordIds: {
      visitPhotos: new Map(archive.payload.visitPhotos.map((photo) => [photoIdMap.get(photo.id)!, photo.id])),
      visitAttachments: new Map(
        archive.payload.visitAttachments.map((attachment) => [attachmentIdMap.get(attachment.id)!, attachment.id])
      ),
      generatedPdfs: new Map(archive.payload.generatedPdfs.map((pdf) => [pdfIdMap.get(pdf.id)!, pdf.id]))
    }
  };
}

function collectRestoreBlockers(
  repository: StructuredDataStore,
  archive: ImportedPatientArchiveDescription,
  plan: RestorePlan,
  readResult: PatientArchiveReadResult
) {
  const blockers: PatientArchiveRestoreBlocker[] = [];
  const importedPatient = archive.payload.patient;

  if (!readResult.isValid) {
    blockers.push({
      code: "invalid_archive",
      message: readResult.issues.map((issue) => issue.message).join(" ")
    });
    return blockers;
  }

  for (const issue of readResult.issues) {
    if (issue.code === "missing_asset_file_entry") {
      blockers.push({
        code: "missing_asset_entry",
        message: issue.message,
        entryPath: issue.entryPath
      });
    }
  }

  if (archive.payload.courses.some((course) => course.status === "active")) {
    blockers.push({
      code: "active_course_not_supported",
      message: "Archive restore currently supports completed-history restores only; archives containing active courses are blocked in this phase."
    });
  }

  const existingPatients = repository.fetchPatients("1 = 1", []);
  const identityMatches = existingPatients.filter((patient) => buildIdentityKey(patient) === buildIdentityKey(importedPatient));
  if (identityMatches.length > 1) {
    blockers.push({
      code: "ambiguous_patient_identity",
      message: `Multiple local patients match the imported patient identity (${importedPatient.firstName} ${importedPatient.lastName}, ${importedPatient.dob}, ${importedPatient.mrn}).`
    });
  }

  if (plan.mode === "new_patient" && existingPatients.some((patient) => patient.id === importedPatient.id)) {
    blockers.push({
      code: "conflicting_patient_id",
      message: `Patient id ${importedPatient.id} already exists locally.`,
      relatedId: importedPatient.id
    });
  }

  if (plan.mode === "new_patient" && identityMatches.length === 1) {
    blockers.push({
      code: "conflicting_patient_identity",
      message: `A local patient with matching name, DOB, and MRN already exists (${identityMatches[0]!.id}).`,
      relatedId: identityMatches[0]!.id
    });
  }

  const existingCourses = repository.fetchCourses("1 = 1", []);
  const existingCourseIds = new Set(existingCourses.map((course) => course.id));
  for (const course of plan.courses) {
    if (existingCourseIds.has(course.id)) {
      blockers.push({
        code: "conflicting_course_id",
        message: `Course id ${course.id} already exists locally.`,
        relatedId: course.id
      });
    }
  }

  const existingSites = existingCourses.length ? repository.fetchSites(existingCourses.map((course) => course.id)) : [];
  const existingSiteIds = new Set(existingSites.map((site) => site.id));
  for (const site of plan.sites) {
    if (existingSiteIds.has(site.id)) {
      blockers.push({
        code: "conflicting_site_id",
        message: `Site id ${site.id} already exists locally.`,
        relatedId: site.id
      });
    }
  }

  const existingVisitBundles = existingCourses.length ? repository.fetchVisitsByCourseIds(existingCourses.map((course) => course.id)) : [];
  const existingVisitIds = new Set(existingVisitBundles.map((bundle) => bundle.note.id));
  const existingPhotoIds = new Set(existingVisitBundles.flatMap((bundle) => bundle.photos.map((photo) => photo.id)));
  const existingAttachmentIds = new Set(existingVisitBundles.flatMap((bundle) => bundle.attachments.map((attachment) => attachment.id)));
  const existingPdfIds = new Set(existingVisitBundles.flatMap((bundle) => bundle.pdfs.map((pdf) => pdf.id)));

  for (const visit of plan.visits) {
    if (existingVisitIds.has(visit.id)) {
      blockers.push({
        code: "conflicting_visit_id",
        message: `Visit id ${visit.id} already exists locally.`,
        relatedId: visit.id
      });
    }
  }

  for (const photo of plan.visitPhotos) {
    if (existingPhotoIds.has(photo.id)) {
      blockers.push({
        code: "conflicting_visit_photo_id",
        message: `Visit photo id ${photo.id} already exists locally.`,
        relatedId: photo.id
      });
    }
  }

  for (const attachment of plan.visitAttachments) {
    if (existingAttachmentIds.has(attachment.id)) {
      blockers.push({
        code: "conflicting_visit_attachment_id",
        message: `Visit attachment id ${attachment.id} already exists locally.`,
        relatedId: attachment.id
      });
    }
  }

  for (const pdf of plan.generatedPdfs) {
    if (existingPdfIds.has(pdf.id)) {
      blockers.push({
        code: "conflicting_generated_pdf_id",
        message: `Generated PDF id ${pdf.id} already exists locally.`,
        relatedId: pdf.id
      });
    }
  }

  return blockers;
}

export async function preflightBrowserArchiveRestore(
  repository: StructuredDataStore,
  readResult: PatientArchiveReadResult,
  archiveHandle: ImportedPatientArchiveDescription["sourceArchive"]
): Promise<PatientArchivePreflightResult> {
  const importedPatientId = readResult.archive?.manifest.patientId ?? "unknown-patient";

  if (!readResult.archive) {
    return {
      status: "blocked",
      sourceArchive: archiveHandle,
      patientId: importedPatientId,
      targetPatientId: null,
      restoreMode: null,
      manifest: null,
      archiveWarnings: [],
      validationIssues: readResult.issues,
      restoreBlockers: [],
      notices: []
    };
  }

  const plan = buildRestorePlan(repository, readResult.archive);
  const blockers = collectRestoreBlockers(repository, readResult.archive, plan, readResult);

  return {
    status: readResult.isValid && blockers.length === 0 ? "supported" : "blocked",
    sourceArchive: archiveHandle,
    patientId: readResult.archive.manifest.patientId,
    targetPatientId: plan.canonicalPatient.id,
    restoreMode: plan.mode,
    manifest: readResult.archive.manifest,
    archiveWarnings: readResult.archive.warnings,
    validationIssues: readResult.issues,
    restoreBlockers: blockers,
    notices: plan.notices
  };
}

export async function restoreBrowserArchive(
  repository: BrowserStructuredDataStore,
  assetStore: BrowserBinaryAssetStoreLike,
  readResult: PatientArchiveReadResult,
  archiveHandle: ImportedPatientArchiveDescription["sourceArchive"],
  archiveBytes: Uint8Array
): Promise<PatientArchiveRestoreResult> {
  const importedPatientId = readResult.archive?.manifest.patientId ?? "unknown-patient";

  if (!readResult.archive) {
    return {
      status: "blocked",
      sourceArchive: archiveHandle,
      patientId: importedPatientId,
      blockers: [
        {
          code: "invalid_archive",
          message:
            readResult.issues.map((issue) => issue.message).join(" ") || "Archive could not be parsed into a restorable description."
        }
      ],
      restoredCounts: null,
      notices: []
    };
  }

  await assetStore.ready();
  const zip = await JSZip.loadAsync(archiveBytes);
  const plan = buildRestorePlan(repository, readResult.archive);
  const blockers = collectRestoreBlockers(repository, readResult.archive, plan, readResult);
  if (blockers.length) {
    return {
      status: "blocked",
      sourceArchive: archiveHandle,
      patientId: plan.canonicalPatient.id,
      blockers,
      restoredCounts: null,
      notices: plan.notices
    };
  }

  const notices = [...plan.notices];
  const currentCanonical = repository.fetchPatient(plan.canonicalPatient.id);
  const restoredFacePhotoPath =
    plan.shouldApplyImportedFacePhoto && plan.importedFaceDescriptor
      ? await restoreBinaryAsset(zip, plan.importedFaceDescriptor, buildPatientFaceTargetPath(assetStore, plan.canonicalPatient, plan.importedFaceDescriptor))
      : null;

  const restoredFacePhotoAsset =
    plan.shouldApplyImportedFacePhoto && plan.importedFaceDescriptor && restoredFacePhotoPath
      ? registerRestoredAsset(assetStore, plan.importedFaceDescriptor.asset, restoredFacePhotoPath.filePath, restoredFacePhotoPath.blob)
      : currentCanonical?.facePhoto ?? null;

  repository.savePatient(plan.patientInput, restoredFacePhotoPath?.filePath ?? null);

  let restoredAssetCount = 0;
  if (plan.shouldApplyImportedFacePhoto && plan.importedFaceDescriptor && restoredFacePhotoAsset) {
    restoredAssetCount += 1;
  }

  if (plan.shouldApplyImportedFacePhoto && plan.importedFaceDescriptor) {
    if (!restoredFacePhotoAsset) {
      notices.push("Imported face photo metadata was detected but could not be restored into browser storage.");
    }
  } else if (currentCanonical?.facePhoto && plan.importedFaceDescriptor) {
    notices.push("Existing local face photo metadata was preserved; imported archive face photo was not applied.");
  }

  const sitesByCourseId = new Map<string, TreatmentSiteInput[]>();
  for (const site of plan.sites) {
    const list = sitesByCourseId.get(site.courseId) || [];
    list.push({
      id: site.id,
      siteNumber: site.siteNumber,
      bodyLocation: site.bodyLocation,
      treatmentLocationText: site.treatmentLocationText,
      diagnosisText: site.diagnosisText,
      icd10: site.icd10,
      numberOfBlocks: site.numberOfBlocks,
      lesionSize: site.lesionSize,
      treatmentDepth: site.treatmentDepth,
      coneSize: site.coneSize,
      cutoutSize: site.cutoutSize,
      shields: site.shields,
      machine: site.machine,
      energyKv: site.energyKv,
      treatmentInterval: site.treatmentInterval,
      additionalDevices: site.additionalDevices,
      dailyDose: site.dailyDose,
      totalDose: site.totalDose
    });
    sitesByCourseId.set(site.courseId, list);
  }

  for (const course of [...plan.courses].sort((left, right) => left.startDate.localeCompare(right.startDate))) {
    if (course.status === "archived") {
      notices.push(`Course ${course.courseName} was restored as completed instead of archived so the patient appears in Completed Patients.`);
    }

    repository.saveCourse({
      id: course.id,
      patientId: plan.canonicalPatient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: "completed",
      sites: (sitesByCourseId.get(course.id) || []).sort((left, right) => left.siteNumber - right.siteNumber)
    } satisfies CourseInput);
  }

  const photosByVisitId = new Map<string, VisitPhotoRecord[]>();
  for (const photo of plan.visitPhotos) {
    const list = photosByVisitId.get(photo.visitNoteId) || [];
    list.push(photo);
    photosByVisitId.set(photo.visitNoteId, list);
  }

  const attachmentsByVisitId = new Map<string, VisitAttachmentRecord[]>();
  for (const attachment of plan.visitAttachments) {
    const list = attachmentsByVisitId.get(attachment.visitNoteId) || [];
    list.push(attachment);
    attachmentsByVisitId.set(attachment.visitNoteId, list);
  }

  const pdfsByVisitId = new Map<string, GeneratedPdfRecord[]>();
  for (const pdf of plan.generatedPdfs) {
    const list = pdfsByVisitId.get(pdf.visitNoteId) || [];
    list.push(pdf);
    pdfsByVisitId.set(pdf.visitNoteId, list);
  }

  for (const visit of [...plan.visits].sort((left, right) =>
    `${left.visitDate}|${left.createdAt}`.localeCompare(`${right.visitDate}|${right.createdAt}`)
    )) {
      repository.saveVisit(
      {
        id: visit.id,
        patientId: visit.patientId,
        courseId: visit.courseId,
        visitDate: visit.visitDate,
        noteType: visit.noteType,
        treatmentNumber: visit.treatmentNumber,
        status: visit.status,
        therapistName: visit.therapistName,
        vitals: visit.vitals,
        structuredFields: visit.structuredFields,
        generatedText: visit.generatedText,
        editedText: visit.editedText,
        newPhotoUploads: [],
        newAttachmentUploads: []
      } satisfies VisitInput,
      visit.generatedText,
      visit.editedText
    );

    for (const photo of [...(photosByVisitId.get(visit.id) || [])].sort((left, right) => left.sortOrder - right.sortOrder)) {
      const sourceId = plan.sourceRecordIds.visitPhotos.get(photo.id) ?? photo.id;
      const descriptor = requireDescriptor(readResult.archive, "visit_photo", sourceId);
      const restoredPhoto = await restoreBinaryAsset(zip, descriptor, buildVisitPhotoTargetPath(assetStore, plan.canonicalPatient, visit, descriptor));
      const restoredPhotoAsset = registerRestoredAsset(assetStore, photo.imageAsset, restoredPhoto.filePath, restoredPhoto.blob);
      if (restoredPhotoAsset) {
        restoredAssetCount += 1;
      }
      repository.restoreVisitPhotoRecord(photo, restoredPhoto.filePath);
    }

    for (const attachment of [...(attachmentsByVisitId.get(visit.id) || [])].sort((left, right) => left.sortOrder - right.sortOrder)) {
      const sourceId = plan.sourceRecordIds.visitAttachments.get(attachment.id) ?? attachment.id;
      const descriptor = requireDescriptor(readResult.archive, "visit_attachment", sourceId);
      const restoredAttachment = await restoreBinaryAsset(
        zip,
        descriptor,
        buildVisitAttachmentTargetPath(assetStore, plan.canonicalPatient, visit, descriptor)
      );
      const restoredAttachmentAsset = registerRestoredAsset(
        assetStore,
        attachment.fileAsset,
        restoredAttachment.filePath,
        restoredAttachment.blob
      );
      if (restoredAttachmentAsset) {
        restoredAssetCount += 1;
      }
      repository.restoreVisitAttachmentRecord(attachment, restoredAttachment.filePath);
    }

    for (const pdf of [...(pdfsByVisitId.get(visit.id) || [])].sort((left, right) => left.versionNumber - right.versionNumber)) {
      const sourceId = plan.sourceRecordIds.generatedPdfs.get(pdf.id) ?? pdf.id;
      const descriptor = requireDescriptor(readResult.archive, "generated_pdf", sourceId);
      const restoredPdf = await restoreBinaryAsset(zip, descriptor, buildGeneratedPdfTargetPath(assetStore, plan.canonicalPatient, visit, descriptor));
      const restoredPdfAsset = registerRestoredAsset(assetStore, pdf.fileAsset, restoredPdf.filePath, restoredPdf.blob);
      if (restoredPdfAsset) {
        restoredAssetCount += 1;
      }
      repository.restoreGeneratedPdfRecord(pdf, restoredPdf.filePath);
    }
  }

  await repository.flush();
  await assetStore.flush();

  return {
    status: "restored",
    sourceArchive: archiveHandle,
    patientId: plan.canonicalPatient.id,
    blockers: [],
    restoredCounts: {
      courses: plan.courses.length,
      sites: plan.sites.length,
      visitNotes: plan.visits.length,
      visitPhotos: plan.visitPhotos.length,
      visitAttachments: plan.visitAttachments.length,
      generatedPdfs: plan.generatedPdfs.length,
      restoredAssets: restoredAssetCount
    },
    notices
  };
}

function requireDescriptor(
  archive: ImportedPatientArchiveDescription,
  recordType: ArchiveAssetDescriptor["recordType"],
  recordId: string
) {
  const descriptor = archive.assets.find((asset) => asset.recordType === recordType && asset.recordId === recordId);
  if (!descriptor) {
    throw new Error(`Archive descriptor missing for ${recordType} ${recordId}.`);
  }
  return descriptor;
}

function registerRestoredAsset(
  assetStore: BrowserBinaryAssetStoreLike,
  asset: AssetReference,
  filePath: string,
  blob: Blob
) {
  return assetStore.registerStoredAssetReference(asset, filePath, blob);
}

async function restoreBinaryAsset(zip: JSZip, descriptor: ArchiveAssetDescriptor, filePath: string) {
  const entry = zip.file(descriptor.packagePath);
  if (!entry) {
    throw new Error(`Archive asset ${descriptor.packagePath} is missing.`);
  }

  const bytes = await entry.async("uint8array");
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: descriptor.mimeType ?? "application/octet-stream" });
  return { filePath, blob };
}

function buildBrowserAssetPath(assetId: string, folderPath: string, fileName: string) {
  return `browser-asset://${assetId}/${folderPath.replace(/^browser:\/\//, "")}/${encodeURIComponent(fileName)}`;
}

function buildPatientFaceTargetPath(
  assetStore: BinaryAssetStore,
  patient: PatientRecord,
  descriptor: ArchiveAssetDescriptor
) {
  return buildBrowserAssetPath(descriptor.asset.assetId, assetStore.getPatientProfileDir(patient.id), descriptor.fileName);
}

function buildVisitPhotoTargetPath(
  assetStore: BinaryAssetStore,
  patient: PatientRecord,
  visit: VisitNoteRecord,
  descriptor: ArchiveAssetDescriptor
) {
  return buildBrowserAssetPath(
    descriptor.asset.assetId,
    assetStore.getVisitPhotosDir(patient.id, visit.courseId, visit.id),
    descriptor.fileName
  );
}

function buildVisitAttachmentTargetPath(
  assetStore: BinaryAssetStore,
  patient: PatientRecord,
  visit: VisitNoteRecord,
  descriptor: ArchiveAssetDescriptor
) {
  return buildBrowserAssetPath(
    descriptor.asset.assetId,
    assetStore.getVisitAttachmentsDir(patient.id, visit.courseId, visit.id),
    descriptor.fileName
  );
}

function buildGeneratedPdfTargetPath(
  assetStore: BinaryAssetStore,
  patient: PatientRecord,
  visit: VisitNoteRecord,
  descriptor: ArchiveAssetDescriptor
) {
  return buildBrowserAssetPath(
    descriptor.asset.assetId,
    assetStore.getVisitWorkspaceDir(patient.id, visit.courseId, visit.id),
    descriptor.fileName
  );
}
