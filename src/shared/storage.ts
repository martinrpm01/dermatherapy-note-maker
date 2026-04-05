import type {
  AssetKind,
  AssetReference,
  AppSettingsRecord,
  AppSettingsView,
  CourseInput,
  GeneratedPdfRecord,
  PatientInput,
  PatientRecord,
  SavedOptionRecord,
  SavedOptionType,
  StoredAssetUpload,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitAttachmentRecord,
  VisitInput,
  VisitNoteRecord,
  VisitPhotoRecord
} from "./types";

type SqlValue = string | number | null;

export type PersistedSettingsInput = AppSettingsView & {
  dermatologyOfficeLogoPath?: string | null;
};

export interface VisitAssetRecordSet {
  note: VisitNoteRecord;
  photos: VisitPhotoRecord[];
  attachments: VisitAttachmentRecord[];
  pdfs: GeneratedPdfRecord[];
}

export interface CourseAssetRecordSet {
  course: TreatmentCourseRecord;
  visits: VisitAssetRecordSet[];
}

export interface PatientAssetRecordSet {
  patient: PatientRecord | null;
  courses: CourseAssetRecordSet[];
}

export interface StructuredDataStore {
  readonly baseDir: string;
  readonly dataDir: string;
  readonly storageDir: string;
  readonly dbPath: string;

  initialize(): Promise<void>;
  getSettingsRecord(): AppSettingsRecord;
  toSettingsView(record: AppSettingsRecord): AppSettingsView;
  updatePin(hash: string, salt: string): void;
  updateSettings(input: PersistedSettingsInput): void;
  getSavedOptions(): SavedOptionRecord[];
  deleteSavedOption(optionId: string): void;
  rememberOption(type: SavedOptionType, value: string, normalizedValue: string): void;
  fetchPatients(whereClause?: string, params?: SqlValue[]): PatientRecord[];
  fetchPatient(patientId: string): PatientRecord | null;
  savePatient(input: PatientInput, facePhotoPath: string | null): PatientRecord;
  setPatientStatus(patientId: string, status: PatientRecord["status"]): void;
  fetchCourses(whereClause?: string, params?: SqlValue[]): TreatmentCourseRecord[];
  fetchCourse(courseId: string): TreatmentCourseRecord | null;
  saveCourse(input: CourseInput): TreatmentCourseRecord;
  updateCoursePrescribedFractions(courseId: string, prescribedFractions: number): void;
  setCourseStatus(courseId: string, status: TreatmentCourseRecord["status"], endDate?: string | null): void;
  fetchSites(courseIds: string[]): TreatmentSiteRecord[];
  fetchVisit(visitId: string): VisitNoteRecord | null;
  fetchVisitsByCourseIds(courseIds: string[]): VisitAssetRecordSet[];
  fetchVisitPhotos(visitId: string): VisitPhotoRecord[];
  fetchVisitAttachments(visitId: string): VisitAttachmentRecord[];
  fetchVisitPhoto(photoId: string): VisitPhotoRecord | null;
  fetchVisitAttachment(attachmentId: string): VisitAttachmentRecord | null;
  fetchGeneratedPdfs(visitId: string): GeneratedPdfRecord[];
  saveVisit(input: VisitInput, generatedText: string, editedText: string): VisitNoteRecord;
  addVisitPhoto(visitId: string, imagePath: string, sortOrder: number, caption: string): void;
  restoreVisitPhotoRecord(record: VisitPhotoRecord, imagePath: string): void;
  addVisitAttachment(
    visitId: string,
    filePath: string,
    sortOrder: number,
    caption: string,
    mimeType: string,
    originalName: string
  ): void;
  restoreVisitAttachmentRecord(record: VisitAttachmentRecord, filePath: string): void;
  deleteVisitPhotoRecord(photoId: string): void;
  deleteVisitAttachmentRecord(attachmentId: string): void;
  deleteVisitRecords(visitId: string): void;
  deleteCourseRecords(courseId: string): void;
  hardDeletePatientRecords(patientId: string): void;
  insertGeneratedPdf(visitId: string, filePath: string, versionNumber: number): void;
  restoreGeneratedPdfRecord(record: GeneratedPdfRecord, filePath: string): void;
  getTemplates(): TemplateDefinitionRecord[];
  getTemplate(templateIdOrKey: string): TemplateDefinitionRecord | null;
  saveTemplate(templateId: string, templateText: string): TemplateDefinitionRecord;
  resetTemplate(templateId: string): TemplateDefinitionRecord;
  rewriteStoredPathPrefix(fromPrefix: string, toPrefix: string): void;
  countPatients(whereClause: string, params?: SqlValue[]): number;
  countCourses(whereClause: string, params?: SqlValue[]): number;
  fetchCompletedPatientIds(): string[];
  fetchArchivePatientIds(): string[];
  loadPatientDetails(patientIds: string[]): Array<{
    patient: PatientRecord;
    courses: Array<{
      course: TreatmentCourseRecord;
      sites: TreatmentSiteRecord[];
      visits: VisitAssetRecordSet[];
    }>;
  }>;
  getVisitAssetRecordSet(visitId: string): VisitAssetRecordSet | null;
  getCourseAssetRecordSet(courseId: string): CourseAssetRecordSet | null;
  getPatientAssetRecordSet(patientId: string): PatientAssetRecordSet;
}

export interface BinaryAssetStore {
  readonly rootDir: string;

  initialize(): void;
  getPatientProfileDir(patientId: string): string;
  getVisitPhotosDir(patientId: string, courseId: string, visitId: string): string;
  getVisitAttachmentsDir(patientId: string, courseId: string, visitId: string): string;
  getVisitWorkspaceDir(patientId: string, courseId: string, visitId: string): string;
  getSettingsBrandingDir(): string;
  saveUpload(upload: StoredAssetUpload, folderPath: string, filePrefix: string): string;
  createAssetReference(filePath: string | null, kind: AssetKind): AssetReference | null;
  resolveAssetPath(asset: AssetReference | null): string | null;
  resolveAssetPathById(assetId: string): string | null;
  writeBinaryFile(filePath: string, data: Uint8Array): void;
  deleteFile(filePath: string): void;
  deleteFiles(filePaths: string[]): void;
  directoryExists(dirPath: string): boolean;
  removeDirectory(dirPath: string): void;
  ensureDirectory(dirPath: string): void;
  cleanupEmptyDirectoryChain(startDir: string, stopDir: string): void;
}
