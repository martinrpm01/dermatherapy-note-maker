import JSZip from "jszip";

import {
  PATIENT_ARCHIVE_FORMAT_VERSION,
  type ArchiveAssetDescriptor,
  type ImportedArchiveFileEntry,
  type ImportedPatientArchiveDescription,
  type PatientArchiveIoHandle,
  type PatientArchiveManifest,
  type PatientArchivePreparationWarning,
  type PatientArchiveReadResult,
  type PatientArchiveStructuredPayload,
  type PatientArchiveValidationIssue
} from "./archive";
import type {
  GeneratedPdfRecord,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitAttachmentRecord,
  VisitNoteRecord,
  VisitPhotoRecord
} from "./types";

const REQUIRED_JSON_ENTRIES = [
  "manifest.json",
  "patient.json",
  "courses.json",
  "sites.json",
  "visit-notes.json",
  "visit-photos.json",
  "visit-attachments.json",
  "generated-pdfs.json",
  "asset-descriptors.json",
  "warnings.json"
] as const;

function hasString(value: unknown): value is string {
  return typeof value === "string";
}

function parseJsonShape<T>(
  zip: JSZip,
  entryPath: string,
  issues: PatientArchiveValidationIssue[],
  validate: (value: unknown) => value is T
) {
  const entry = zip.file(entryPath);
  if (!entry) {
    issues.push({
      severity: "error",
      code: "missing_required_entry",
      message: `Required archive entry ${entryPath} is missing.`,
      entryPath
    });
    return null;
  }

  return entry.async("string").then((raw) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!validate(parsed)) {
        issues.push({
          severity: "error",
          code: "invalid_json_shape",
          message: `Archive entry ${entryPath} has an unexpected JSON shape.`,
          entryPath
        });
        return null;
      }
      return parsed;
    } catch (error) {
      issues.push({
        severity: "error",
        code: "json_parse_failed",
        message: `Archive entry ${entryPath} could not be parsed: ${error instanceof Error ? error.message : "Unknown JSON error."}`,
        entryPath
      });
      return null;
    }
  });
}

function isManifest(value: unknown): value is PatientArchiveManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const manifest = value as Record<string, unknown>;
  return (
    manifest.archiveType === "patient_archive" &&
    typeof manifest.archiveVersion === "number" &&
    hasString(manifest.preparedAt) &&
    hasString(manifest.patientId)
  );
}

function isPatientRecord(value: unknown): value is PatientRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const patient = value as Record<string, unknown>;
  return hasString(patient.id) && hasString(patient.firstName) && hasString(patient.lastName) && hasString(patient.mrn) && hasString(patient.dob);
}

function isCourseRecordArray(value: unknown): value is TreatmentCourseRecord[] {
  return Array.isArray(value);
}

function isSiteRecordArray(value: unknown): value is TreatmentSiteRecord[] {
  return Array.isArray(value);
}

function isVisitNoteRecordArray(value: unknown): value is VisitNoteRecord[] {
  return Array.isArray(value);
}

function isVisitPhotoRecordArray(value: unknown): value is VisitPhotoRecord[] {
  return Array.isArray(value);
}

function isVisitAttachmentRecordArray(value: unknown): value is VisitAttachmentRecord[] {
  return Array.isArray(value);
}

function isGeneratedPdfRecordArray(value: unknown): value is GeneratedPdfRecord[] {
  return Array.isArray(value);
}

function isAssetDescriptorArray(value: unknown): value is ArchiveAssetDescriptor[] {
  return Array.isArray(value);
}

function isPreparationWarningArray(value: unknown): value is PatientArchivePreparationWarning[] {
  return Array.isArray(value);
}

export async function readPatientArchiveFromBytes(
  archive: PatientArchiveIoHandle,
  archiveBytes: Uint8Array
): Promise<PatientArchiveReadResult> {
  const issues: PatientArchiveValidationIssue[] = [];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archiveBytes);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "archive_open_failed",
      message: `Could not open archive: ${error instanceof Error ? error.message : "Unknown ZIP error."}`
    });
    return {
      isValid: false,
      archive: null,
      issues
    };
  }

  for (const entryPath of REQUIRED_JSON_ENTRIES) {
    if (!zip.file(entryPath)) {
      issues.push({
        severity: "error",
        code: "missing_required_entry",
        message: `Required archive entry ${entryPath} is missing.`,
        entryPath
      });
    }
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return {
      isValid: false,
      archive: null,
      issues
    };
  }

  const [
    manifest,
    patient,
    courses,
    sites,
    visitNotes,
    visitPhotos,
    visitAttachments,
    generatedPdfs,
    assets,
    warnings
  ] = await Promise.all([
    parseJsonShape(zip, "manifest.json", issues, isManifest),
    parseJsonShape(zip, "patient.json", issues, isPatientRecord),
    parseJsonShape(zip, "courses.json", issues, isCourseRecordArray),
    parseJsonShape(zip, "sites.json", issues, isSiteRecordArray),
    parseJsonShape(zip, "visit-notes.json", issues, isVisitNoteRecordArray),
    parseJsonShape(zip, "visit-photos.json", issues, isVisitPhotoRecordArray),
    parseJsonShape(zip, "visit-attachments.json", issues, isVisitAttachmentRecordArray),
    parseJsonShape(zip, "generated-pdfs.json", issues, isGeneratedPdfRecordArray),
    parseJsonShape(zip, "asset-descriptors.json", issues, isAssetDescriptorArray),
    parseJsonShape(zip, "warnings.json", issues, isPreparationWarningArray)
  ]);

  if (!manifest || !patient || !courses || !sites || !visitNotes || !visitPhotos || !visitAttachments || !generatedPdfs || !assets || !warnings) {
    return {
      isValid: false,
      archive: null,
      issues
    };
  }

  if (manifest.archiveType !== "patient_archive") {
    issues.push({
      severity: "error",
      code: "invalid_archive_type",
      message: `Unsupported archive type ${String(manifest.archiveType)}.`
    });
  }

  if (manifest.archiveVersion !== PATIENT_ARCHIVE_FORMAT_VERSION) {
    issues.push({
      severity: "error",
      code: "unsupported_archive_version",
      message: `Archive version ${manifest.archiveVersion} is not supported. Expected version ${PATIENT_ARCHIVE_FORMAT_VERSION}.`
    });
  }

  for (const asset of assets) {
    if (!zip.file(asset.packagePath)) {
      issues.push({
        severity: "warning",
        code: "missing_asset_file_entry",
        message: `Archive asset entry ${asset.packagePath} is missing from the ZIP.`,
        entryPath: asset.packagePath
      });
    }
  }

  const fileEntries: ImportedArchiveFileEntry[] = await Promise.all(
    Object.values(zip.files).map(async (entry) => {
      if (entry.dir) {
        return {
          packagePath: entry.name,
          isDirectory: true,
          compressedSize: 0,
          uncompressedSize: 0
        };
      }

      const content = await entry.async("uint8array");
      return {
        packagePath: entry.name,
        isDirectory: false,
        compressedSize: content.byteLength,
        uncompressedSize: content.byteLength
      };
    })
  );

  const archiveDescription: ImportedPatientArchiveDescription = {
    sourceArchive: archive,
    manifest,
    payload: {
      patient,
      courses,
      sites,
      visitNotes,
      visitPhotos,
      visitAttachments,
      generatedPdfs
    } satisfies PatientArchiveStructuredPayload,
    assets,
    warnings,
    fileEntries
  };

  return {
    isValid: !issues.some((issue) => issue.severity === "error"),
    archive: archiveDescription,
    issues
  };
}
