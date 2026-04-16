import type {
  PatientArchiveExportResult,
  PatientArchiveIoHandle,
  PatientArchivePreflightResult,
  PatientArchiveReadResult,
  PatientArchiveRestoreResult
} from "./archive";
export type CourseType = "one_site" | "two_site" | "consult";
export type NoteType = "consult_sim" | "first_fraction" | "standard_treatment" | "otv";
export type PatientStatus = "active" | "archived" | "deleted";
export type CourseStatus = "active" | "completed" | "archived";
export type VisitStatus = "draft" | "finalized" | "archived";
export type LaunchReadyScreen = "loading" | "pin_setup" | "unlock" | "dashboard";
export type AssetKind = "patient_face_photo" | "visit_photo" | "visit_attachment" | "generated_pdf" | "settings_logo";

export interface AssetReference {
  assetId: string;
  kind: AssetKind;
}
export type SavedOptionType =
  | "therapist"
  | "body_location"
  | "treatment_location"
  | "machine"
  | "other";

export interface AppSettingsRecord {
  id: number;
  appName: string;
  pinHash: string | null;
  pinSalt: string | null;
  recoveryCodeHash?: string | null;
  recoveryCodeSalt?: string | null;
  defaultTherapist: string;
  supervisingPhysician: string;
  dermatologyOfficeName: string;
  dermatologyOfficeLogoPath: string | null;
  inactivityTimeoutMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettingsView {
  appName: string;
  defaultTherapist: string;
  supervisingPhysician: string;
  dermatologyOfficeName: string;
  dermatologyOfficeLogoAsset: AssetReference | null;
  dermatologyOfficeLogoUpload?: StoredAssetUpload | null;
  removeDermatologyOfficeLogo?: boolean;
  inactivityTimeoutMinutes: number;
}

export interface SavedOptionRecord {
  id: string;
  type: SavedOptionType;
  value: string;
  normalizedValue: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PatientRecord {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
  sex: string;
  facePhoto: AssetReference | null;
  status: PatientStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TreatmentCourseRecord {
  id: string;
  patientId: string;
  courseName: string;
  courseType: CourseType;
  prescribedFractions: number;
  status: CourseStatus;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TreatmentSiteRecord {
  id: string;
  courseId: string;
  siteNumber: 1 | 2;
  bodyLocation: string;
  treatmentLocationText: string;
  diagnosisText: string;
  icd10: string;
  numberOfBlocks: number;
  lesionSize: string;
  treatmentDepth: string;
  coneSize: string;
  cutoutSize: string;
  shields: string;
  machine: string;
  energyKv: string;
  treatmentInterval: string;
  additionalDevices: string;
  dailyDose: number;
  totalDose: number;
  prescribedFractions?: number;
  createdAt: string;
  updatedAt: string;
}

export interface VisitPhotoRecord {
  id: string;
  visitNoteId: string;
  imageAsset: AssetReference;
  sortOrder: number;
  caption: string;
  siteNumber?: 1 | 2;
  createdAt: string;
}

export interface VisitAttachmentRecord {
  id: string;
  visitNoteId: string;
  fileAsset: AssetReference;
  sortOrder: number;
  caption: string;
  mimeType: string;
  originalName: string;
  createdAt: string;
}

export interface GeneratedPdfRecord {
  id: string;
  visitNoteId: string;
  fileAsset: AssetReference;
  versionNumber: number;
  createdAt: string;
}

export interface Vitals {
  bloodPressure: string;
  heartRate: string;
  oxygenSaturation: string;
  weight: string;
}

export interface SiteSnapshot {
  siteNumber: 1 | 2;
  bodyLocation: string;
  treatmentLocationText: string;
  diagnosisText: string;
  biopsyDate?: string;
  icd10: string;
  numberOfBlocks: number;
  lesionSize: string;
  treatmentDepth: string;
  coneSize: string;
  cutoutSize: string;
  shields: string;
  machine: string;
  energyKv: string;
  treatmentInterval: string;
  additionalDevices: string;
  dailyDose: number;
  totalDose: number;
  cumulativeDose: number;
  prescribedFractions?: number;
}

export interface VisitStructuredFields {
  chiefComplaint: string;
  additionalNotes: string;
  finalTreatment: boolean;
  prescribedFractionsInput: number | null;
  biopsyDate: string;
  lastTreatmentDate: string;
  focusedExam: string;
  healingDescription: string;
  examComment: string;
  impressionPlanComments: string;
  postCare: string;
  followUp: string;
  simulationComplications: string;
  treatmentComment: string;
  physicsComment: string;
  consultReview: string;
  treatmentOptions: string;
  risksAndBenefits: string;
  additionalInformation: string;
  otherInstructions: string;
  supervisedBy: string;
  startRadiationDate: string;
  ultrasoundPerformed: string;
  addMips: boolean;
  siteSnapshots: SiteSnapshot[];
}

export interface VisitNoteRecord {
  id: string;
  patientId: string;
  courseId: string;
  visitDate: string;
  noteType: NoteType;
  treatmentNumber: number | null;
  status: VisitStatus;
  therapistName: string;
  vitals: Vitals;
  structuredFields: VisitStructuredFields;
  generatedText: string;
  editedText: string;
  pdfAsset: AssetReference | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDefinitionRecord {
  id: string;
  key: string;
  courseType: CourseType;
  noteType: NoteType;
  templateText: string;
  defaultTemplateText: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePlaceholderDefinition {
  token: string;
  description: string;
}

export interface PatientInput {
  id?: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
  sex?: string;
  notes: string;
  facePhotoUpload?: StoredAssetUpload | null;
}

export interface TreatmentSiteInput {
  id?: string;
  siteNumber: 1 | 2;
  bodyLocation: string;
  treatmentLocationText: string;
  diagnosisText: string;
  icd10: string;
  numberOfBlocks: number;
  lesionSize: string;
  treatmentDepth: string;
  coneSize: string;
  cutoutSize: string;
  shields: string;
  machine: string;
  energyKv: string;
  treatmentInterval: string;
  additionalDevices: string;
  dailyDose: number;
  totalDose: number;
  prescribedFractions?: number;
}

export interface CourseInput {
  id?: string;
  patientId: string;
  courseName: string;
  courseType: CourseType;
  prescribedFractions: number;
  startDate: string;
  endDate?: string | null;
  status?: CourseStatus;
  sites: TreatmentSiteInput[];
}

export interface StoredAssetUpload {
  name: string;
  mimeType: string;
  dataUrl: string;
  caption?: string;
  siteNumber?: 1 | 2;
}

export interface VisitInput {
  id?: string;
  patientId: string;
  courseId: string;
  visitDate: string;
  noteType: NoteType;
  treatmentNumber: number | null;
  status: VisitStatus;
  therapistName: string;
  vitals: Vitals;
  structuredFields: VisitStructuredFields;
  generatedText: string;
  editedText: string;
  newPhotoUploads: StoredAssetUpload[];
  newAttachmentUploads: StoredAssetUpload[];
}

export interface DashboardCourseRow {
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientDob: string;
  patientFacePhoto: AssetReference | null;
  courseId: string;
  courseName: string;
  courseType: CourseType;
  prescribedFractions: number;
  currentFraction: number;
  suggestedTreatmentNumber: number | null;
  suggestedNoteType: NoteType;
  nextTemplateKey: string;
  siteSummary: string;
  latestDraftVisitId: string | null;
  latestDraftUpdatedAt: string | null;
}

export interface VisitNoteBundle {
  note: VisitNoteRecord;
  photos: VisitPhotoRecord[];
  attachments: VisitAttachmentRecord[];
  pdfs: GeneratedPdfRecord[];
}

export interface CourseDetail {
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  visits: VisitNoteBundle[];
}

export interface PatientDetail {
  patient: PatientRecord;
  courses: CourseDetail[];
}

export interface ArchiveSnapshot {
  patients: PatientDetail[];
}

export interface VisitEditorState {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  note: VisitInput;
  existingPhotos: VisitPhotoRecord[];
  existingAttachments: VisitAttachmentRecord[];
  generatedPdfs: GeneratedPdfRecord[];
  templateKey: string;
}

export interface BootstrapPayload {
  settings: AppSettingsView;
  requiresPinSetup: boolean;
  isLocked: boolean;
}

export interface DashboardPatientRow {
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientDob: string;
  patientFacePhoto: AssetReference | null;
}

export interface DashboardSnapshot {
  activeCourses: DashboardCourseRow[];
  patientsWithoutCourse: DashboardPatientRow[];
  archivedPatients: number;
  archivedCourses: number;
}

export interface SettingsPayload {
  settings: AppSettingsView;
  savedOptions: SavedOptionRecord[];
}

export interface PdfGenerationResult {
  visitId: string;
  pdfAsset: AssetReference;
  versionNumber: number;
}

export interface TemplateValidationResult {
  isValid: boolean;
  unknownTokens: string[];
}

export interface AppClient {
  bootstrap: () => Promise<BootstrapPayload>;
  reportReady: (screen: LaunchReadyScreen) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => Promise<void>;
  setInitialPin: (pin: string) => Promise<string | null>;
  changePin: (currentPin: string, nextPin: string) => Promise<void>;
  resetPinWithRecoveryCode: (recoveryCode: string, nextPin: string) => Promise<string | null>;
  wipeAllLocalData: () => Promise<void>;
  getDashboardSnapshot: () => Promise<DashboardSnapshot>;
  getPatientDetail: (patientId: string) => Promise<PatientDetail>;
  listCompleted: () => Promise<ArchiveSnapshot>;
  listArchive: () => Promise<ArchiveSnapshot>;
  savePatient: (input: PatientInput) => Promise<PatientRecord>;
  archivePatient: (patientId: string) => Promise<void>;
  restorePatient: (patientId: string) => Promise<void>;
  deletePatient: (patientId: string) => Promise<void>;
  permanentlyDeletePatient: (patientId: string) => Promise<void>;
  pickPatientArchive: () => Promise<PatientArchiveIoHandle | null>;
  exportPatientArchive: (patientId: string) => Promise<PatientArchiveExportResult>;
  preflightPatientArchive: (archive: PatientArchiveIoHandle) => Promise<PatientArchivePreflightResult>;
  readPatientArchive: (archive: PatientArchiveIoHandle) => Promise<PatientArchiveReadResult>;
  restorePatientArchive: (archive: PatientArchiveIoHandle) => Promise<PatientArchiveRestoreResult>;
  saveCourse: (input: CourseInput) => Promise<TreatmentCourseRecord>;
  completeCourse: (courseId: string) => Promise<void>;
  restoreCourse: (courseId: string) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  buildVisitDraft: (
    courseId: string,
    mode?: "next_treatment" | "consult_sim",
    existingVisitId?: string
  ) => Promise<VisitEditorState>;
  saveVisit: (input: VisitInput) => Promise<VisitNoteRecord>;
  deleteVisit: (visitId: string) => Promise<void>;
  generatePdf: (visitId: string) => Promise<PdfGenerationResult>;
  // Desktop-first helper that returns the local visit workspace path.
  // A future browser client can map this to a virtual folder or download flow.
  getVisitFolder: (visitId: string) => Promise<string>;
  removeVisitPhoto: (photoId: string) => Promise<void>;
  removeVisitAttachment: (attachmentId: string) => Promise<void>;
  getSettingsPayload: () => Promise<SettingsPayload>;
  saveSettings: (input: AppSettingsView) => Promise<AppSettingsView>;
  deleteSavedOption: (optionId: string) => Promise<void>;
  getTemplates: () => Promise<TemplateDefinitionRecord[]>;
  saveTemplate: (templateId: string, templateText: string) => Promise<TemplateDefinitionRecord>;
  resetTemplate: (templateId: string) => Promise<TemplateDefinitionRecord>;
  // Desktop-only native shell integrations. A future browser client can
  // implement these as no-ops or browser-safe open/download alternatives.
  // Portable asset URL resolution seam. Desktop can return asset:// URLs,
  // while browser can return blob: URLs for the same AssetReference.
  resolveAssetUrl: (asset: AssetReference | null) => Promise<string | null>;
  revealAsset: (asset: AssetReference) => Promise<void>;
  openAsset: (asset: AssetReference) => Promise<void>;
  revealPath: (targetPath: string) => Promise<void>;
  openPath: (targetPath: string) => Promise<void>;
}

export type ElectronApi = AppClient;
