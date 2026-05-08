import type {
  PatientArchiveExportResult,
  PatientArchiveIoHandle,
  PatientArchivePreflightResult,
  PatientArchiveReadResult,
  PatientArchiveRestoreResult
} from "./archive";
import type { AppUpdateCheckResult } from "./app-update";
export type { AppUpdateCheckResult } from "./app-update";
export type CourseType = "one_site" | "two_site" | "consult";
export type NoteType = "consult_sim" | "first_fraction" | "standard_treatment" | "otv";
export type PatientStatus = "active" | "archived" | "deleted";
export type CourseStatus = "pending" | "active" | "completed" | "archived";
export type VisitStatus = "draft" | "finalized" | "archived";
export type ScheduleAppointmentType = "treatment" | "sim_consult" | "follow_up";
export type ScheduleAppointmentStatus = "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";
export type ScheduleBlockType = "holiday" | "closed" | "unavailable";
export type LaunchReadyScreen = "loading" | "pin_setup" | "unlock" | "dashboard";
export type AssetKind =
  | "patient_face_photo"
  | "visit_photo"
  | "visit_attachment"
  | "generated_pdf"
  | "course_document"
  | "settings_logo";
export type CourseDocumentType = "consent_form" | "sim_worksheet";
export type DocumentOnlyFileType = "consent_form" | "sim_worksheet";

export interface AssetReference {
  assetId: string;
  kind: AssetKind;
}
export type SavedOptionType =
  | "therapist"
  | "physician"
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
  rememberSupervisingPhysician?: boolean;
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
  simConsultDate: string | null;
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
  worksheetSide: string;
  worksheetPositioning: string;
  worksheetVacLokArea: string;
  worksheetEyeShieldType: string;
  worksheetGumShieldPosition: string;
  worksheetLipShieldPosition: string;
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

export interface ScheduleAppointmentRecord {
  id: string;
  patientId: string | null;
  courseId: string | null;
  patientName: string;
  patientFirstName: string;
  patientLastName: string;
  patientMrn: string;
  patientDob: string;
  patientSex: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  appointmentType: ScheduleAppointmentType;
  appointmentNumber: number | null;
  totalAppointments: number | null;
  status: ScheduleAppointmentStatus;
  notes: string;
  seriesId: string | null;
  intakeCourseType: Exclude<CourseType, "consult"> | null;
  intakeBiopsyDate: string;
  intakeSites: ScheduleIntakeSiteInput[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleIntakeSiteInput {
  siteNumber: 1 | 2;
  treatmentLocationText: string;
  diagnosisText: string;
  icd10: string;
  projectedFractions: number | null;
}

export interface ScheduleBlockRecord {
  id: string;
  title: string;
  blockDate: string | null;
  startTime: string;
  endTime: string;
  blockType: ScheduleBlockType;
  isRecurring: boolean;
  recurringWeekdays: number[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSettingsView {
  clinicStartTime: string;
  clinicEndTime: string;
}

export interface CourseDocumentRecord {
  id: string;
  courseId: string;
  documentType: CourseDocumentType;
  fileAsset: AssetReference;
  caption: string;
  mimeType: string;
  originalName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentOnlyRecord {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
  sex: string;
  therapistName: string;
  courseType: Exclude<CourseType, "consult">;
  biopsyDate: string;
  simConsultDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentOnlySiteRecord {
  id: string;
  recordId: string;
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
  worksheetSide: string;
  worksheetPositioning: string;
  worksheetVacLokArea: string;
  worksheetEyeShieldType: string;
  worksheetGumShieldPosition: string;
  worksheetLipShieldPosition: string;
  dailyDose: number;
  totalDose: number;
  projectedFractions: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentOnlyFileRecord {
  id: string;
  recordId: string;
  fileType: DocumentOnlyFileType;
  fileAsset: AssetReference;
  caption: string;
  mimeType: string;
  originalName: string;
  createdAt: string;
  updatedAt: string;
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
  worksheetSide: string;
  worksheetPositioning: string;
  worksheetVacLokArea: string;
  worksheetEyeShieldType: string;
  worksheetGumShieldPosition: string;
  worksheetLipShieldPosition: string;
  dailyDose: number;
  totalDose: number;
  cumulativeDose: number;
  prescribedFractions?: number;
  doseManuallyAdjusted?: boolean;
}

export interface VisitStructuredFields {
  chiefComplaint: string;
  additionalNotes: string;
  includeExamVitals: boolean;
  finalTreatment: boolean;
  prescribedFractionsInput: number | null;
  projectedFractionsInput: number | null;
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
  worksheetSide: string;
  worksheetPositioning: string;
  worksheetVacLokArea: string;
  worksheetEyeShieldType: string;
  worksheetGumShieldPosition: string;
  worksheetLipShieldPosition: string;
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
  simConsultDate?: string;
  endDate?: string | null;
  status?: CourseStatus;
  sites: TreatmentSiteInput[];
}

export interface DocumentOnlySiteInput {
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
  worksheetSide: string;
  worksheetPositioning: string;
  worksheetVacLokArea: string;
  worksheetEyeShieldType: string;
  worksheetGumShieldPosition: string;
  worksheetLipShieldPosition: string;
  dailyDose: number;
  totalDose: number;
  projectedFractions?: number | null;
}

export interface DocumentOnlyInput {
  id?: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string;
  sex: string;
  therapistName: string;
  courseType: Exclude<CourseType, "consult">;
  biopsyDate: string;
  simConsultDate: string;
  sites: DocumentOnlySiteInput[];
}

export interface StoredAssetUpload {
  name: string;
  mimeType: string;
  dataUrl: string;
  caption?: string;
  siteNumber?: 1 | 2;
}

export interface ConsentSigningInput {
  signDate: string;
  patientInitials: string;
  patientPrintedName: string;
  formerRadiationAcknowledged: boolean;
  medicalDevicesAcknowledged: boolean;
  patientSignatureDataUrl: string;
  witnessPrintedName: string;
  witnessSignatureDataUrl: string;
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

export interface DashboardPendingCourseRow {
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientDob: string;
  patientFacePhoto: AssetReference | null;
  courseId: string;
  courseName: string;
  courseType: CourseType;
  prescribedFractions: number;
  siteSummary: string;
  hasConsentForm: boolean;
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
  documents: CourseDocumentRecord[];
  visits: VisitNoteBundle[];
}

export interface PatientDetail {
  patient: PatientRecord;
  courses: CourseDetail[];
}

export interface ArchiveSnapshot {
  patients: PatientDetail[];
}

export interface DocumentOnlyDetail {
  record: DocumentOnlyRecord;
  sites: DocumentOnlySiteRecord[];
  files: DocumentOnlyFileRecord[];
}

export interface DocumentOnlySnapshot {
  records: DocumentOnlyDetail[];
}

export interface VisitEditorState {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  courseDocuments: CourseDocumentRecord[];
  note: VisitInput;
  existingPhotos: VisitPhotoRecord[];
  existingAttachments: VisitAttachmentRecord[];
  generatedPdfs: GeneratedPdfRecord[];
  templateKey: string;
}

export interface VisitDraftOptions {
  visitDate?: string;
  treatmentNumber?: number | null;
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
  pendingCourses: DashboardPendingCourseRow[];
  patientsWithoutCourse: DashboardPatientRow[];
  archivedPatients: number;
  archivedCourses: number;
}

export interface ScheduleSnapshot {
  appointments: ScheduleAppointmentRecord[];
  blocks: ScheduleBlockRecord[];
  settings: ScheduleSettingsView;
  activeCourses: DashboardCourseRow[];
}

export interface ScheduleAppointmentInput {
  id?: string;
  patientId?: string | null;
  courseId?: string | null;
  patientName: string;
  patientFirstName?: string;
  patientLastName?: string;
  patientMrn?: string;
  patientDob?: string;
  patientSex?: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  appointmentType: ScheduleAppointmentType;
  appointmentNumber?: number | null;
  totalAppointments?: number | null;
  status?: ScheduleAppointmentStatus;
  notes?: string;
  seriesId?: string | null;
  intakeCourseType?: Exclude<CourseType, "consult"> | null;
  intakeBiopsyDate?: string;
  intakeSites?: ScheduleIntakeSiteInput[];
}

export interface ScheduleBlockInput {
  id?: string;
  title: string;
  blockDate?: string | null;
  startTime: string;
  endTime: string;
  blockType: ScheduleBlockType;
  isRecurring?: boolean;
  recurringWeekdays?: number[];
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
  getScheduleSnapshot: (startDate: string, endDate: string) => Promise<ScheduleSnapshot>;
  saveScheduleAppointment: (input: ScheduleAppointmentInput) => Promise<ScheduleAppointmentRecord>;
  deleteScheduleAppointment: (appointmentId: string) => Promise<void>;
  deleteCourseTreatmentSchedule: (courseId: string) => Promise<number>;
  updateScheduleAppointmentStatus: (
    appointmentId: string,
    status: ScheduleAppointmentStatus
  ) => Promise<ScheduleAppointmentRecord>;
  saveScheduleBlock: (input: ScheduleBlockInput) => Promise<ScheduleBlockRecord>;
  deleteScheduleBlock: (blockId: string) => Promise<void>;
  saveScheduleSettings: (input: ScheduleSettingsView) => Promise<ScheduleSettingsView>;
  completeScheduleAppointmentForVisit: (visitId: string) => Promise<ScheduleAppointmentRecord | null>;
  getDocumentOnlySnapshot: () => Promise<DocumentOnlySnapshot>;
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
  saveDocumentOnlyRecord: (input: DocumentOnlyInput) => Promise<DocumentOnlyRecord>;
  deleteDocumentOnlyRecord: (recordId: string) => Promise<void>;
  generateDocumentOnlyConsent: (recordId: string) => Promise<DocumentOnlyFileRecord>;
  finalizeDocumentOnlyConsent: (recordId: string, input: ConsentSigningInput) => Promise<DocumentOnlyFileRecord>;
  generateDocumentOnlySimWorksheet: (recordId: string) => Promise<DocumentOnlyFileRecord>;
  completeCourse: (courseId: string) => Promise<void>;
  restoreCourse: (courseId: string) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
  buildVisitDraft: (
    courseId: string,
    mode?: "next_treatment" | "consult_sim",
    existingVisitId?: string,
    options?: VisitDraftOptions
  ) => Promise<VisitEditorState>;
  saveVisit: (input: VisitInput) => Promise<VisitNoteRecord>;
  deleteVisit: (visitId: string) => Promise<void>;
  generatePdf: (visitId: string) => Promise<PdfGenerationResult>;
  generateSimWorksheet: (visitId: string) => Promise<VisitAttachmentRecord>;
  generateConsentForm: (courseId: string) => Promise<CourseDocumentRecord>;
  generateCourseSimWorksheet: (courseId: string) => Promise<CourseDocumentRecord>;
  finalizeConsentForm: (courseId: string, input: ConsentSigningInput) => Promise<CourseDocumentRecord>;
  uploadConsentForm: (courseId: string, upload: StoredAssetUpload) => Promise<CourseDocumentRecord>;
  deleteConsentForm: (courseId: string) => Promise<void>;
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
  checkForUpdates: () => Promise<AppUpdateCheckResult>;
  openUpdateDownload: () => Promise<void>;
}

export type ElectronApi = AppClient;
