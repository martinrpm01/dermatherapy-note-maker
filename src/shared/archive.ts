import type {
  AssetKind,
  AssetReference,
  GeneratedPdfRecord,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitAttachmentRecord,
  VisitNoteRecord,
  VisitPhotoRecord
} from "./types";

export const PATIENT_ARCHIVE_FORMAT_VERSION = 1 as const;

export interface PatientArchiveIoHandle {
  kind: "desktop_path";
  fileName: string;
  path: string;
}

export interface PatientArchiveIdentity {
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
}

export interface PatientArchiveManifest {
  archiveType: "patient_archive";
  archiveVersion: typeof PATIENT_ARCHIVE_FORMAT_VERSION;
  preparedAt: string;
  patientId: string;
  patientIdentity: PatientArchiveIdentity;
  patientStatusAtExport: PatientRecord["status"];
  suggestedRestoreBucket: "completed_patients";
  recordCounts: {
    courses: number;
    sites: number;
    visitNotes: number;
    visitPhotos: number;
    visitAttachments: number;
    generatedPdfs: number;
  };
  assetCounts: Record<AssetKind, number>;
}

export interface ArchiveAssetDescriptor {
  asset: AssetReference;
  category: AssetKind;
  recordType: "patient" | "visit_photo" | "visit_attachment" | "generated_pdf";
  recordId: string;
  patientId: string;
  courseId: string | null;
  visitNoteId: string | null;
  packagePath: string;
  fileName: string;
  mimeType: string | null;
  originalName: string | null;
  caption: string | null;
  sortOrder: number | null;
  versionNumber: number | null;
  availableLocally: boolean;
}

export interface PatientArchiveStructuredPayload {
  patient: PatientRecord;
  courses: TreatmentCourseRecord[];
  sites: TreatmentSiteRecord[];
  visitNotes: VisitNoteRecord[];
  visitPhotos: VisitPhotoRecord[];
  visitAttachments: VisitAttachmentRecord[];
  generatedPdfs: GeneratedPdfRecord[];
}

export interface PatientArchivePreparationWarning {
  code: "missing_asset_file";
  message: string;
  assetId: string;
  recordId: string;
}

export interface PreparedPatientArchiveDescription {
  manifest: PatientArchiveManifest;
  payload: PatientArchiveStructuredPayload;
  assets: ArchiveAssetDescriptor[];
  warnings: PatientArchivePreparationWarning[];
}

export interface PatientArchiveExportResult {
  patientId: string;
  archiveHandle: PatientArchiveIoHandle;
  includedAssetCount: number;
  missingAssetCount: number;
  warnings: PatientArchivePreparationWarning[];
}

export interface ImportedArchiveFileEntry {
  packagePath: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ImportedPatientArchiveDescription {
  sourceArchive: PatientArchiveIoHandle;
  manifest: PatientArchiveManifest;
  payload: PatientArchiveStructuredPayload;
  assets: ArchiveAssetDescriptor[];
  warnings: PatientArchivePreparationWarning[];
  fileEntries: ImportedArchiveFileEntry[];
}

export interface PatientArchiveValidationIssue {
  severity: "error" | "warning";
  code:
    | "archive_open_failed"
    | "missing_required_entry"
    | "invalid_archive_type"
    | "unsupported_archive_version"
    | "json_parse_failed"
    | "invalid_json_shape"
    | "missing_asset_file_entry";
  message: string;
  entryPath?: string;
}

export interface PatientArchiveReadResult {
  isValid: boolean;
  archive: ImportedPatientArchiveDescription | null;
  issues: PatientArchiveValidationIssue[];
}

export type PatientArchiveRestoreMode = "new_patient" | "merge_existing_patient";

export interface PatientArchiveRestoreBlocker {
  code:
    | "invalid_archive"
    | "missing_asset_entry"
    | "active_course_not_supported"
    | "ambiguous_patient_identity"
    | "conflicting_patient_id"
    | "conflicting_patient_identity"
    | "conflicting_course_id"
    | "conflicting_site_id"
    | "conflicting_visit_id"
    | "conflicting_visit_photo_id"
    | "conflicting_visit_attachment_id"
    | "conflicting_generated_pdf_id"
    | "conflicting_generated_pdf_output_path";
  message: string;
  relatedId?: string;
  entryPath?: string;
}

export interface PatientArchiveRestoreCounts {
  courses: number;
  sites: number;
  visitNotes: number;
  visitPhotos: number;
  visitAttachments: number;
  generatedPdfs: number;
  restoredAssets: number;
}

export interface PatientArchiveRestoreResult {
  status: "restored" | "blocked";
  sourceArchive: PatientArchiveIoHandle;
  patientId: string;
  blockers: PatientArchiveRestoreBlocker[];
  restoredCounts: PatientArchiveRestoreCounts | null;
  notices: string[];
}

export interface PatientArchivePreflightResult {
  status: "supported" | "blocked";
  sourceArchive: PatientArchiveIoHandle;
  patientId: string;
  targetPatientId: string | null;
  restoreMode: PatientArchiveRestoreMode | null;
  manifest: PatientArchiveManifest | null;
  archiveWarnings: PatientArchivePreparationWarning[];
  validationIssues: PatientArchiveValidationIssue[];
  restoreBlockers: PatientArchiveRestoreBlocker[];
  notices: string[];
}
