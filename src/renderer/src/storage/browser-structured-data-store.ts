import type {
  AppSettingsRecord,
  AppSettingsView,
  CourseDocumentRecord,
  CourseInput,
  DocumentOnlyFileRecord,
  DocumentOnlyInput,
  DocumentOnlyRecord,
  DocumentOnlySiteRecord,
  GeneratedPdfRecord,
  PatientInput,
  PatientRecord,
  SavedOptionRecord,
  SavedOptionType,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitAttachmentRecord,
  VisitInput,
  VisitNoteRecord,
  VisitPhotoRecord
} from "../../../shared/types";
import type {
  CourseAssetRecordSet,
  PatientAssetRecordSet,
  PersistedSettingsInput,
  StructuredDataStore,
  VisitAssetRecordSet
} from "../../../shared/storage";
import { DEFAULT_TEMPLATE_DEFINITIONS } from "../../../shared/templates";

type BrowserStoreName =
  | "settings"
  | "savedOptions"
  | "patients"
  | "documentOnlyRecords"
  | "documentOnlySites"
  | "documentOnlyFiles"
  | "courses"
  | "sites"
  | "courseDocuments"
  | "visitNotes"
  | "visitPhotos"
  | "visitAttachments"
  | "generatedPdfs"
  | "templates";

type SqlValue = string | number | null;

const DATABASE_NAME = "dermatherapy-note-maker-browser";
const DATABASE_VERSION = 3;

const DEFAULT_SETTINGS_RECORD: AppSettingsRecord = {
  id: 1,
  appName: "ClearSkin Hub",
  pinHash: null,
  pinSalt: null,
  recoveryCodeHash: null,
  recoveryCodeSalt: null,
  defaultTherapist: "",
  supervisingPhysician: "",
  dermatologyOfficeName: "",
  dermatologyOfficeLogoPath: null,
  inactivityTimeoutMinutes: 5,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function createSyntheticAssetId(prefix: string, seed?: string) {
  const normalizedSeed = seed?.trim();
  return normalizedSeed ? `browser_${prefix}_${normalizedSeed}` : `browser_${prefix}_${makeId(prefix)}`;
}

function parseBrowserAssetId(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }

  const match = filePath.match(/^browser-asset:\/\/([^/]+)(?:\/.*)?$/);
  return match?.[1] ?? null;
}

function createAssetReferenceForPath(
  kind: "patient_face_photo" | "visit_photo" | "visit_attachment" | "generated_pdf" | "course_document" | "settings_logo",
  seed?: string
) {
  const existingAssetId = parseBrowserAssetId(seed);
  return {
    assetId: existingAssetId ?? createSyntheticAssetId(kind, seed),
    kind
  };
}

function normalizeIdentityPart(value: string) {
  return value.trim().toLowerCase();
}

function formatMeasurement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const mmMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return `${mmMatch[1]}mm`;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}mm`;
  }

  return normalized;
}

function normalizeIcd10(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function applyWhereClause<T extends object>(rows: T[], whereClause?: string, params: SqlValue[] = []) {
  if (!whereClause || whereClause.trim() === "" || whereClause.trim() === "1 = 1") {
    return rows;
  }

  const clauses = whereClause
    .split(/\s+AND\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return rows.filter((row) =>
    clauses.every((clause, clauseIndex) => {
      const match = clause.match(/^([a-zA-Z0-9_]+)\s*=\s*\?$/);
      if (!match) {
        throw new Error(`BrowserStructuredDataStore does not support where clause: ${whereClause}`);
      }

      const column = match[1]!;
      const expected = params[clauseIndex];
      const camelKey = column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return (row as Record<string, unknown>)[camelKey] === expected;
    })
  );
}

function sortVisits(a: VisitNoteRecord, b: VisitNoteRecord) {
  const leftTreatment = a.treatmentNumber ?? 0;
  const rightTreatment = b.treatmentNumber ?? 0;
  if (leftTreatment !== rightTreatment) {
    return leftTreatment - rightTreatment;
  }

  const dateComparison = a.visitDate.localeCompare(b.visitDate);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  return a.createdAt.localeCompare(b.createdAt);
}

export class BrowserStructuredDataStore implements StructuredDataStore {
  readonly baseDir = "browser://dermatherapy-note-maker";
  readonly dataDir = "browser://dermatherapy-note-maker/data";
  readonly storageDir = "browser://dermatherapy-note-maker/storage";
  readonly dbPath = "indexeddb://dermatherapy-note-maker-browser";

  private db: IDBDatabase | null = null;
  private settings = { ...DEFAULT_SETTINGS_RECORD };
  private savedOptions = new Map<string, SavedOptionRecord>();
  private patients = new Map<string, PatientRecord>();
  private documentOnlyRecords = new Map<string, DocumentOnlyRecord>();
  private documentOnlySites = new Map<string, DocumentOnlySiteRecord>();
  private documentOnlyFiles = new Map<string, DocumentOnlyFileRecord>();
  private courses = new Map<string, TreatmentCourseRecord>();
  private sites = new Map<string, TreatmentSiteRecord>();
  private courseDocuments = new Map<string, CourseDocumentRecord>();
  private visitNotes = new Map<string, VisitNoteRecord>();
  private visitPhotos = new Map<string, VisitPhotoRecord>();
  private visitAttachments = new Map<string, VisitAttachmentRecord>();
  private generatedPdfs = new Map<string, GeneratedPdfRecord>();
  private templates = new Map<string, TemplateDefinitionRecord>();
  private pendingWrites: Promise<void> = Promise.resolve();
  private initialized = false;

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.db = await this.openDatabase();
    await this.loadAllStores();
    await this.ensureTemplateDefaults();
    this.initialized = true;
  }

  async flush() {
    await this.pendingWrites;
  }

  async wipeAllData() {
    await this.flush();
    if (this.db) {
      this.db.close();
    }

    await this.deleteDatabase();
    this.db = null;
    this.initialized = false;
    this.pendingWrites = Promise.resolve();
    this.settings = { ...DEFAULT_SETTINGS_RECORD };
    this.savedOptions.clear();
    this.patients.clear();
    this.documentOnlyRecords.clear();
    this.documentOnlySites.clear();
    this.documentOnlyFiles.clear();
    this.courses.clear();
    this.sites.clear();
    this.courseDocuments.clear();
    this.visitNotes.clear();
    this.visitPhotos.clear();
    this.visitAttachments.clear();
    this.generatedPdfs.clear();
    this.templates.clear();
  }

  getSettingsRecord() {
    this.ensureInitialized();
    return { ...this.settings };
  }

  toSettingsView(record: AppSettingsRecord): AppSettingsView {
    return {
      appName: record.appName,
      defaultTherapist: record.defaultTherapist,
      supervisingPhysician: record.supervisingPhysician,
      dermatologyOfficeName: record.dermatologyOfficeName,
      dermatologyOfficeLogoAsset: record.dermatologyOfficeLogoPath
        ? createAssetReferenceForPath("settings_logo", record.dermatologyOfficeLogoPath)
        : null,
      inactivityTimeoutMinutes: 5
    };
  }

  updatePin(hash: string, salt: string) {
    this.ensureInitialized();
    this.settings = {
      ...this.settings,
      pinHash: hash,
      pinSalt: salt,
      updatedAt: nowIso()
    };
    this.queuePut("settings", this.settings);
  }

  updateRecoveryCode(hash: string, salt: string) {
    this.ensureInitialized();
    this.settings = {
      ...this.settings,
      recoveryCodeHash: hash,
      recoveryCodeSalt: salt,
      updatedAt: nowIso()
    };
    this.queuePut("settings", this.settings);
  }

  updateSettings(input: PersistedSettingsInput) {
    this.ensureInitialized();
    this.settings = {
      ...this.settings,
      appName: input.appName,
      defaultTherapist: input.defaultTherapist,
      supervisingPhysician: input.supervisingPhysician,
      dermatologyOfficeName: input.dermatologyOfficeName,
      dermatologyOfficeLogoPath: input.dermatologyOfficeLogoPath ?? null,
      inactivityTimeoutMinutes: 5,
      updatedAt: nowIso()
    };
    this.queuePut("settings", this.settings);
  }

  getSavedOptions() {
    this.ensureInitialized();
    return [...this.savedOptions.values()].filter((option) => option.active);
  }

  deleteSavedOption(optionId: string) {
    this.ensureInitialized();
    this.savedOptions.delete(optionId);
    this.queueDelete("savedOptions", optionId);
  }

  rememberOption(type: SavedOptionType, value: string, normalizedValue: string) {
    this.ensureInitialized();
    const record: SavedOptionRecord = {
      id: makeId("saved-option"),
      type,
      value,
      normalizedValue,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.savedOptions.set(record.id, record);
    this.queuePut("savedOptions", record);
  }

  fetchPatients(whereClause?: string, params: SqlValue[] = []): PatientRecord[] {
    this.ensureInitialized();
    return applyWhereClause([...this.patients.values()], whereClause, params);
  }

  fetchPatient(patientId: string) {
    this.ensureInitialized();
    return this.patients.get(patientId) ?? null;
  }

  savePatient(input: PatientInput, facePhotoPath: string | null) {
    this.ensureInitialized();
    const existing = input.id ? this.patients.get(input.id) ?? null : null;
    const patient: PatientRecord = {
      id: input.id ?? makeId("patient"),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      mrn: input.mrn.trim(),
      dob: input.dob,
      sex: input.sex ?? "",
      facePhoto: facePhotoPath
        ? createAssetReferenceForPath("patient_face_photo", facePhotoPath)
        : (existing?.facePhoto ?? null),
      status: existing?.status ?? "active",
      notes: input.notes,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      archivedAt: existing?.archivedAt ?? null
    };
    this.patients.set(patient.id, patient);
    this.queuePut("patients", patient);
    return patient;
  }

  setPatientStatus(patientId: string, status: PatientRecord["status"]) {
    this.ensureInitialized();
    const patient = this.requireRecord(this.patients, patientId, "Patient");
    const next: PatientRecord = {
      ...patient,
      status,
      updatedAt: nowIso(),
      archivedAt: status === "archived" ? nowIso() : null
    };
    this.patients.set(patientId, next);
    this.queuePut("patients", next);

    if (status !== "active") {
      for (const course of this.fetchCourses("patient_id = ?", [patientId]).filter((item) => item.status === "active" || item.status === "pending")) {
        const nextCourse: TreatmentCourseRecord = {
          ...course,
          status: "archived",
          archivedAt: nowIso(),
          updatedAt: nowIso()
        };
        this.courses.set(course.id, nextCourse);
        this.queuePut("courses", nextCourse);
      }
    }
  }

  fetchDocumentOnlyRecords(recordId?: string) {
    this.ensureInitialized();
    const records = [...this.documentOnlyRecords.values()].sort(
      (left, right) => `${right.updatedAt}|${right.lastName}|${right.firstName}`.localeCompare(`${left.updatedAt}|${left.lastName}|${left.firstName}`)
    );
    return recordId ? records.filter((record) => record.id === recordId) : records;
  }

  fetchDocumentOnlySites(recordIds: string[]) {
    this.ensureInitialized();
    return [...this.documentOnlySites.values()]
      .filter((site) => recordIds.includes(site.recordId))
      .sort((left, right) => `${left.recordId}|${left.siteNumber}`.localeCompare(`${right.recordId}|${right.siteNumber}`));
  }

  fetchDocumentOnlyFiles(recordId: string) {
    this.ensureInitialized();
    return [...this.documentOnlyFiles.values()]
      .filter((file) => file.recordId === recordId)
      .sort((left, right) => `${right.updatedAt}|${right.createdAt}`.localeCompare(`${left.updatedAt}|${left.createdAt}`));
  }

  saveDocumentOnlyRecord(input: DocumentOnlyInput) {
    this.ensureInitialized();
    const existing = input.id ? this.documentOnlyRecords.get(input.id) ?? null : null;
    const record: DocumentOnlyRecord = {
      id: input.id ?? makeId("document-only"),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      mrn: input.mrn.trim(),
      dob: input.dob,
      sex: input.sex.trim(),
      therapistName: input.therapistName.trim(),
      courseType: input.courseType,
      biopsyDate: input.biopsyDate,
      simConsultDate: input.simConsultDate,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    };

    this.documentOnlyRecords.set(record.id, record);
    this.queuePut("documentOnlyRecords", record);

    for (const existingSite of [...this.documentOnlySites.values()].filter((site) => site.recordId === record.id)) {
      this.documentOnlySites.delete(existingSite.id);
      this.queueDelete("documentOnlySites", existingSite.id);
    }

    for (const siteInput of input.sites) {
      const site: DocumentOnlySiteRecord = {
        id: siteInput.id ?? makeId("document-only-site"),
        recordId: record.id,
        siteNumber: siteInput.siteNumber,
        bodyLocation: siteInput.bodyLocation,
        treatmentLocationText: siteInput.treatmentLocationText,
        diagnosisText: siteInput.diagnosisText,
        icd10: normalizeIcd10(siteInput.icd10),
        numberOfBlocks: siteInput.numberOfBlocks,
        lesionSize: formatMeasurement(siteInput.lesionSize),
        treatmentDepth: siteInput.treatmentDepth,
        coneSize: siteInput.coneSize,
        cutoutSize: siteInput.cutoutSize,
        shields: siteInput.shields,
        machine: siteInput.machine,
        energyKv: siteInput.energyKv,
        treatmentInterval: siteInput.treatmentInterval,
        additionalDevices: siteInput.additionalDevices,
        worksheetSide: siteInput.worksheetSide,
        worksheetPositioning: siteInput.worksheetPositioning,
        worksheetVacLokArea: siteInput.worksheetVacLokArea,
        worksheetEyeShieldType: siteInput.worksheetEyeShieldType,
        worksheetGumShieldPosition: siteInput.worksheetGumShieldPosition,
        worksheetLipShieldPosition: siteInput.worksheetLipShieldPosition,
        dailyDose: siteInput.dailyDose,
        totalDose: siteInput.totalDose,
        projectedFractions: siteInput.projectedFractions ?? null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      this.documentOnlySites.set(site.id, site);
      this.queuePut("documentOnlySites", site);
    }

    return record;
  }

  upsertDocumentOnlyFile(
    recordId: string,
    fileType: DocumentOnlyFileRecord["fileType"],
    filePath: string,
    caption: string,
    mimeType: string,
    originalName: string
  ) {
    this.ensureInitialized();
    const existing = this.fetchDocumentOnlyFiles(recordId).find((file) => file.fileType === fileType) ?? null;
    const record: DocumentOnlyFileRecord = {
      id: existing?.id ?? makeId("document-only-file"),
      recordId,
      fileType,
      fileAsset: createAssetReferenceForPath("course_document", filePath),
      caption,
      mimeType,
      originalName,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    };
    this.documentOnlyFiles.set(record.id, record);
    this.queuePut("documentOnlyFiles", record);
    const parentRecord = this.documentOnlyRecords.get(recordId);
    if (parentRecord) {
      const nextParent: DocumentOnlyRecord = {
        ...parentRecord,
        updatedAt: nowIso()
      };
      this.documentOnlyRecords.set(recordId, nextParent);
      this.queuePut("documentOnlyRecords", nextParent);
    }
    return record;
  }

  deleteDocumentOnlyFileRecord(fileId: string) {
    this.ensureInitialized();
    this.documentOnlyFiles.delete(fileId);
    this.queueDelete("documentOnlyFiles", fileId);
  }

  deleteDocumentOnlyRecord(recordId: string) {
    this.ensureInitialized();
    for (const file of this.fetchDocumentOnlyFiles(recordId)) {
      this.documentOnlyFiles.delete(file.id);
      this.queueDelete("documentOnlyFiles", file.id);
    }
    for (const site of this.fetchDocumentOnlySites([recordId])) {
      this.documentOnlySites.delete(site.id);
      this.queueDelete("documentOnlySites", site.id);
    }
    this.documentOnlyRecords.delete(recordId);
    this.queueDelete("documentOnlyRecords", recordId);
  }

  fetchCourses(whereClause?: string, params: SqlValue[] = []): TreatmentCourseRecord[] {
    this.ensureInitialized();
    return applyWhereClause([...this.courses.values()], whereClause, params);
  }

  fetchCourse(courseId: string) {
    this.ensureInitialized();
    return this.courses.get(courseId) ?? null;
  }

  saveCourse(input: CourseInput) {
    this.ensureInitialized();
    const existing = input.id ? this.courses.get(input.id) ?? null : null;
    const course: TreatmentCourseRecord = {
      id: input.id ?? makeId("course"),
      patientId: input.patientId,
      courseName: input.courseName,
      courseType: input.courseType,
      prescribedFractions: input.prescribedFractions,
      status: input.status ?? existing?.status ?? "active",
      startDate: input.startDate,
      simConsultDate: input.simConsultDate?.trim() || null,
      endDate: input.endDate ?? null,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      archivedAt: existing?.archivedAt ?? null
    };

    this.courses.set(course.id, course);
    this.queuePut("courses", course);

    for (const existingSite of [...this.sites.values()].filter((site) => site.courseId === course.id)) {
      this.sites.delete(existingSite.id);
      this.queueDelete("sites", existingSite.id);
    }

    for (const siteInput of input.sites) {
      const site: TreatmentSiteRecord = {
        id: siteInput.id ?? makeId("site"),
        courseId: course.id,
        siteNumber: siteInput.siteNumber,
        bodyLocation: siteInput.bodyLocation,
        treatmentLocationText: siteInput.treatmentLocationText,
        diagnosisText: siteInput.diagnosisText,
        icd10: normalizeIcd10(siteInput.icd10),
        numberOfBlocks: siteInput.numberOfBlocks,
        lesionSize: formatMeasurement(siteInput.lesionSize),
        treatmentDepth: siteInput.treatmentDepth,
        coneSize: siteInput.coneSize,
        cutoutSize: siteInput.cutoutSize,
        shields: siteInput.shields,
        machine: siteInput.machine,
        energyKv: siteInput.energyKv,
        treatmentInterval: siteInput.treatmentInterval,
        additionalDevices: siteInput.additionalDevices,
        worksheetSide: siteInput.worksheetSide,
        worksheetPositioning: siteInput.worksheetPositioning,
        worksheetVacLokArea: siteInput.worksheetVacLokArea,
        worksheetEyeShieldType: siteInput.worksheetEyeShieldType,
        worksheetGumShieldPosition: siteInput.worksheetGumShieldPosition,
        worksheetLipShieldPosition: siteInput.worksheetLipShieldPosition,
        dailyDose: siteInput.dailyDose,
        totalDose: siteInput.totalDose,
        ...(siteInput.prescribedFractions !== undefined ? { prescribedFractions: siteInput.prescribedFractions } : {}),
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      this.sites.set(site.id, site);
      this.queuePut("sites", site);
    }

    return course;
  }

  updateCoursePrescribedFractions(courseId: string, prescribedFractions: number) {
    this.ensureInitialized();
    const course = this.requireRecord(this.courses, courseId, "Course");
    const next = { ...course, prescribedFractions, updatedAt: nowIso() };
    this.courses.set(courseId, next);
    this.queuePut("courses", next);
  }

  updateCourseSitePrescribedFractions(courseId: string, siteNumber: 1 | 2, prescribedFractions: number) {
    this.ensureInitialized();
    const site = [...this.sites.values()].find((entry) => entry.courseId === courseId && entry.siteNumber === siteNumber);
    if (!site) {
      throw new Error(`Treatment site ${siteNumber} not found for course ${courseId}.`);
    }

    const next = { ...site, prescribedFractions, updatedAt: nowIso() };
    this.sites.set(site.id, next);
    this.queuePut("sites", next);
  }

  updateCourseSiteDoseValues(courseId: string, siteNumber: 1 | 2, dailyDose: number, totalDose: number) {
    this.ensureInitialized();
    const site = [...this.sites.values()].find((entry) => entry.courseId === courseId && entry.siteNumber === siteNumber);
    if (!site) {
      throw new Error(`Treatment site ${siteNumber} not found for course ${courseId}.`);
    }

    const next = { ...site, dailyDose, totalDose, updatedAt: nowIso() };
    this.sites.set(site.id, next);
    this.queuePut("sites", next);
  }

  setCourseStatus(courseId: string, status: TreatmentCourseRecord["status"], endDate?: string | null) {
    this.ensureInitialized();
    const course = this.requireRecord(this.courses, courseId, "Course");
    const next: TreatmentCourseRecord = {
      ...course,
      status,
      endDate: endDate ?? course.endDate,
      updatedAt: nowIso(),
      archivedAt: status === "archived" ? nowIso() : null
    };
    this.courses.set(courseId, next);
    this.queuePut("courses", next);
  }

  fetchSites(courseIds: string[]) {
    this.ensureInitialized();
    const courseIdSet = new Set(courseIds);
    return [...this.sites.values()]
      .filter((site) => courseIdSet.has(site.courseId))
      .sort((left, right) => left.siteNumber - right.siteNumber);
  }

  fetchCourseDocuments(courseId: string) {
    this.ensureInitialized();
    return [...this.courseDocuments.values()]
      .filter((document) => document.courseId === courseId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  fetchCourseDocument(documentId: string) {
    this.ensureInitialized();
    return this.courseDocuments.get(documentId) ?? null;
  }

  findOriginalNameForAsset(assetId: string) {
    this.ensureInitialized();
    const courseDocument = [...this.courseDocuments.values()].find((document) => document.fileAsset.assetId === assetId);
    if (courseDocument?.originalName) {
      return courseDocument.originalName;
    }

    const visitAttachment = [...this.visitAttachments.values()].find((attachment) => attachment.fileAsset.assetId === assetId);
    if (visitAttachment?.originalName) {
      return visitAttachment.originalName;
    }

    return null;
  }

  fetchVisit(visitId: string) {
    this.ensureInitialized();
    return this.visitNotes.get(visitId) ?? null;
  }

  fetchVisitsByCourseIds(courseIds: string[]) {
    this.ensureInitialized();
    const courseIdSet = new Set(courseIds);
    return [...this.visitNotes.values()]
      .filter((visit) => courseIdSet.has(visit.courseId))
      .sort(sortVisits)
      .map((note) => ({
        note,
        photos: this.fetchVisitPhotos(note.id),
        attachments: this.fetchVisitAttachments(note.id),
        pdfs: this.fetchGeneratedPdfs(note.id)
      }));
  }

  fetchVisitPhotos(visitId: string) {
    this.ensureInitialized();
    return [...this.visitPhotos.values()]
      .filter((photo) => photo.visitNoteId === visitId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  fetchVisitAttachments(visitId: string) {
    this.ensureInitialized();
    return [...this.visitAttachments.values()]
      .filter((attachment) => attachment.visitNoteId === visitId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  fetchVisitPhoto(photoId: string) {
    this.ensureInitialized();
    return this.visitPhotos.get(photoId) ?? null;
  }

  fetchVisitAttachment(attachmentId: string) {
    this.ensureInitialized();
    return this.visitAttachments.get(attachmentId) ?? null;
  }

  fetchGeneratedPdfs(visitId: string) {
    this.ensureInitialized();
    return [...this.generatedPdfs.values()]
      .filter((pdf) => pdf.visitNoteId === visitId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  saveVisit(input: VisitInput, generatedText: string, editedText: string) {
    this.ensureInitialized();
    const existing = input.id ? this.visitNotes.get(input.id) ?? null : null;
    const visit: VisitNoteRecord = {
      id: input.id ?? makeId("visit"),
      patientId: input.patientId,
      courseId: input.courseId,
      visitDate: input.visitDate,
      noteType: input.noteType,
      treatmentNumber: input.treatmentNumber,
      status: input.status,
      therapistName: input.therapistName,
      vitals: input.vitals,
      structuredFields: input.structuredFields,
      generatedText,
      editedText,
      pdfAsset: existing?.pdfAsset ?? null,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso()
    };
    this.visitNotes.set(visit.id, visit);
    this.queuePut("visitNotes", visit);
    return visit;
  }

  addVisitPhoto(visitId: string, imagePath: string, sortOrder: number, caption: string, siteNumber?: 1 | 2) {
    this.ensureInitialized();
    const record: VisitPhotoRecord = {
      id: makeId("photo"),
      visitNoteId: visitId,
      imageAsset: createAssetReferenceForPath("visit_photo", imagePath),
      sortOrder,
      caption,
      ...(siteNumber !== undefined ? { siteNumber } : {}),
      createdAt: nowIso()
    };
    this.visitPhotos.set(record.id, record);
    this.queuePut("visitPhotos", record);
  }

  restoreVisitPhotoRecord(record: VisitPhotoRecord, _imagePath: string) {
    this.ensureInitialized();
    this.visitPhotos.set(record.id, record);
    this.queuePut("visitPhotos", record);
  }

  addVisitAttachment(
    visitId: string,
    filePath: string,
    sortOrder: number,
    caption: string,
    mimeType: string,
    originalName: string
  ) {
    this.ensureInitialized();
    const record: VisitAttachmentRecord = {
      id: makeId("attachment"),
      visitNoteId: visitId,
      fileAsset: createAssetReferenceForPath("visit_attachment", filePath),
      sortOrder,
      caption,
      mimeType,
      originalName,
      createdAt: nowIso()
    };
    this.visitAttachments.set(record.id, record);
    this.queuePut("visitAttachments", record);
  }

  restoreVisitAttachmentRecord(record: VisitAttachmentRecord, _filePath: string) {
    this.ensureInitialized();
    this.visitAttachments.set(record.id, record);
    this.queuePut("visitAttachments", record);
  }

  deleteVisitPhotoRecord(photoId: string) {
    this.ensureInitialized();
    this.visitPhotos.delete(photoId);
    this.queueDelete("visitPhotos", photoId);
  }

  deleteVisitAttachmentRecord(attachmentId: string) {
    this.ensureInitialized();
    this.visitAttachments.delete(attachmentId);
    this.queueDelete("visitAttachments", attachmentId);
  }

  upsertCourseDocument(
    courseId: string,
    documentType: CourseDocumentRecord["documentType"],
    filePath: string,
    caption: string,
    mimeType: string,
    originalName: string
  ) {
    this.ensureInitialized();
    const existing = this.fetchCourseDocuments(courseId).find((document) => document.documentType === documentType) ?? null;
    const now = nowIso();
    const record: CourseDocumentRecord = {
      id: existing?.id ?? makeId("course-document"),
      courseId,
      documentType,
      fileAsset: createAssetReferenceForPath("course_document", filePath),
      caption,
      mimeType,
      originalName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.courseDocuments.set(record.id, record);
    this.queuePut("courseDocuments", record);
    return record;
  }

  deleteCourseDocumentRecord(documentId: string) {
    this.ensureInitialized();
    this.courseDocuments.delete(documentId);
    this.queueDelete("courseDocuments", documentId);
  }

  deleteVisitRecords(visitId: string) {
    this.ensureInitialized();
    this.visitNotes.delete(visitId);
    this.queueDelete("visitNotes", visitId);
    for (const photo of this.fetchVisitPhotos(visitId)) {
      this.deleteVisitPhotoRecord(photo.id);
    }
    for (const attachment of this.fetchVisitAttachments(visitId)) {
      this.deleteVisitAttachmentRecord(attachment.id);
    }
    for (const pdf of this.fetchGeneratedPdfs(visitId)) {
      this.generatedPdfs.delete(pdf.id);
      this.queueDelete("generatedPdfs", pdf.id);
    }
  }

  deleteCourseRecords(courseId: string) {
    this.ensureInitialized();
    for (const visit of this.fetchVisitsByCourseIds([courseId])) {
      this.deleteVisitRecords(visit.note.id);
    }
    for (const document of this.fetchCourseDocuments(courseId)) {
      this.deleteCourseDocumentRecord(document.id);
    }
    for (const site of this.fetchSites([courseId])) {
      this.sites.delete(site.id);
      this.queueDelete("sites", site.id);
    }
    this.courses.delete(courseId);
    this.queueDelete("courses", courseId);
  }

  hardDeletePatientRecords(patientId: string) {
    this.ensureInitialized();
    for (const course of this.fetchCourses("patient_id = ?", [patientId])) {
      this.deleteCourseRecords(course.id);
    }
    this.patients.delete(patientId);
    this.queueDelete("patients", patientId);
  }

  insertGeneratedPdf(visitId: string, filePath: string, versionNumber: number) {
    this.ensureInitialized();
    const record: GeneratedPdfRecord = {
      id: makeId("pdf"),
      visitNoteId: visitId,
      fileAsset: createAssetReferenceForPath("generated_pdf", filePath),
      versionNumber,
      createdAt: nowIso()
    };
    this.generatedPdfs.set(record.id, record);
    this.queuePut("generatedPdfs", record);
    const visit = this.requireRecord(this.visitNotes, visitId, "Visit");
    const updatedVisit = { ...visit, pdfAsset: record.fileAsset, updatedAt: nowIso() };
    this.visitNotes.set(visitId, updatedVisit);
    this.queuePut("visitNotes", updatedVisit);
  }

  restoreGeneratedPdfRecord(record: GeneratedPdfRecord, _filePath: string) {
    this.ensureInitialized();
    this.generatedPdfs.set(record.id, record);
    this.queuePut("generatedPdfs", record);
    const visit = this.visitNotes.get(record.visitNoteId);
    if (visit) {
      const updatedVisit = { ...visit, pdfAsset: record.fileAsset, updatedAt: nowIso() };
      this.visitNotes.set(visit.id, updatedVisit);
      this.queuePut("visitNotes", updatedVisit);
    }
  }

  getTemplates(): TemplateDefinitionRecord[] {
    this.ensureInitialized();
    return [...this.templates.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  getTemplate(templateIdOrKey: string): TemplateDefinitionRecord | null {
    this.ensureInitialized();
    return (
      [...this.templates.values()].find(
        (template) => template.id === templateIdOrKey || template.key === templateIdOrKey
      ) ?? null
    );
  }

  saveTemplate(templateId: string, templateText: string): TemplateDefinitionRecord {
    this.ensureInitialized();
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} was not found.`);
    }

    const updatedTemplate: TemplateDefinitionRecord = {
      ...template,
      templateText: templateText.trim(),
      updatedAt: nowIso()
    };
    this.templates.set(updatedTemplate.id, updatedTemplate);
    this.queuePut("templates", updatedTemplate);
    return updatedTemplate;
  }

  resetTemplate(templateId: string): TemplateDefinitionRecord {
    this.ensureInitialized();
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} was not found.`);
    }

    const updatedTemplate: TemplateDefinitionRecord = {
      ...template,
      templateText: template.defaultTemplateText,
      updatedAt: nowIso()
    };
    this.templates.set(updatedTemplate.id, updatedTemplate);
    this.queuePut("templates", updatedTemplate);
    return updatedTemplate;
  }

  rewriteStoredPathPrefix(_fromPrefix: string, _toPrefix: string) {
    // Browser persistence does not store filesystem paths, so this becomes a no-op.
  }

  countPatients(whereClause: string, params: SqlValue[] = []) {
    return this.fetchPatients(whereClause, params).length;
  }

  countCourses(whereClause: string, params: SqlValue[] = []) {
    return this.fetchCourses(whereClause, params).length;
  }

  fetchCompletedPatientIds(): string[] {
    const activeCoursePatientIds = new Set(
      this.fetchCourses("1 = 1", [])
        .filter((course) => course.status === "active" || course.status === "pending")
        .map((course) => course.patientId)
    );

    return this.fetchPatients("1 = 1", [])
      .filter((patient) => patient.status === "active" && !activeCoursePatientIds.has(patient.id))
      .map((patient) => patient.id);
  }

  fetchArchivePatientIds(): string[] {
    return this.fetchPatients("1 = 1", [])
      .filter((patient) => patient.status === "archived")
      .map((patient) => patient.id);
  }

  loadPatientDetails(patientIds: string[]) {
    return patientIds
      .map((patientId) => this.fetchPatient(patientId))
      .filter((patient): patient is PatientRecord => Boolean(patient))
      .map((patient) => ({
        patient,
        courses: this.fetchCourses("patient_id = ?", [patient.id]).map((course) => ({
          course,
          sites: this.fetchSites([course.id]),
          documents: this.fetchCourseDocuments(course.id),
          visits: this.fetchVisitsByCourseIds([course.id])
        }))
      }));
  }

  loadDocumentOnlyDetails(recordIds?: string[]) {
    const filteredIds = recordIds?.length ? recordIds : this.fetchDocumentOnlyRecords().map((record) => record.id);
    return filteredIds
      .map((recordId) => this.documentOnlyRecords.get(recordId) ?? null)
      .filter((record): record is DocumentOnlyRecord => Boolean(record))
      .map((record) => ({
        record,
        sites: this.fetchDocumentOnlySites([record.id]),
        files: this.fetchDocumentOnlyFiles(record.id)
      }));
  }

  getVisitAssetRecordSet(visitId: string): VisitAssetRecordSet | null {
    const note = this.fetchVisit(visitId);
    if (!note) {
      return null;
    }
    return {
      note,
      photos: this.fetchVisitPhotos(visitId),
      attachments: this.fetchVisitAttachments(visitId),
      pdfs: this.fetchGeneratedPdfs(visitId)
    };
  }

  getCourseAssetRecordSet(courseId: string): CourseAssetRecordSet | null {
    const course = this.fetchCourse(courseId);
    if (!course) {
      return null;
    }
    return {
      course,
      documents: this.fetchCourseDocuments(courseId),
      visits: this.fetchVisitsByCourseIds([courseId])
    };
  }

  getPatientAssetRecordSet(patientId: string): PatientAssetRecordSet {
    return {
      patient: this.fetchPatient(patientId),
      courses: this.fetchCourses("patient_id = ?", [patientId]).map((course) => ({
        course,
        documents: this.fetchCourseDocuments(course.id),
        visits: this.fetchVisitsByCourseIds([course.id])
      }))
    };
  }

  private ensureInitialized() {
    if (!this.initialized || !this.db) {
      throw new Error("BrowserStructuredDataStore must be initialized before use.");
    }
  }

  private requireRecord<T>(map: Map<string, T>, id: string, label: string) {
    const record = map.get(id);
    if (!record) {
      throw new Error(`${label} ${id} was not found.`);
    }
    return record;
  }

  private queuePut(storeName: BrowserStoreName, value: unknown) {
    this.pendingWrites = this.pendingWrites.then(async () => {
      const db = this.db;
      if (!db) {
        throw new Error("BrowserStructuredDataStore database is not ready.");
      }
      await this.runTransaction(storeName, "readwrite", (store) => store.put(value));
    });
  }

  private queueDelete(storeName: BrowserStoreName, key: IDBValidKey) {
    this.pendingWrites = this.pendingWrites.then(async () => {
      const db = this.db;
      if (!db) {
        throw new Error("BrowserStructuredDataStore database is not ready.");
      }
      await this.runTransaction(storeName, "readwrite", (store) => store.delete(key));
    });
  }

  private async loadAllStores() {
    const [settings] = await this.getAllFromStore<AppSettingsRecord>("settings");
    this.settings = settings ?? { ...DEFAULT_SETTINGS_RECORD };
    this.savedOptions = this.asMap(await this.getAllFromStore<SavedOptionRecord>("savedOptions"));
    this.patients = this.asMap(await this.getAllFromStore<PatientRecord>("patients"));
    this.documentOnlyRecords = this.asMap(await this.getAllFromStore<DocumentOnlyRecord>("documentOnlyRecords"));
    this.documentOnlySites = this.asMap(await this.getAllFromStore<DocumentOnlySiteRecord>("documentOnlySites"));
    this.documentOnlyFiles = this.asMap(await this.getAllFromStore<DocumentOnlyFileRecord>("documentOnlyFiles"));
    this.courses = this.asMap(
      (await this.getAllFromStore<TreatmentCourseRecord>("courses")).map((course) => ({
        ...course,
        simConsultDate: course.simConsultDate ?? null
      }))
    );
    this.sites = this.asMap(await this.getAllFromStore<TreatmentSiteRecord>("sites"));
    this.courseDocuments = this.asMap(await this.getAllFromStore<CourseDocumentRecord>("courseDocuments"));
    const rawVisitNotes = await this.getAllFromStore<VisitNoteRecord>("visitNotes");
    const normalizedVisitNotes = rawVisitNotes.map((note) => {
      // Migrate older records that predate the addMips field
      const sf = note.structuredFields as VisitNoteRecord["structuredFields"] & { addMips?: boolean };
      return {
        ...note,
        structuredFields: { ...sf, addMips: sf.addMips ?? false }
      };
    });
    this.visitNotes = this.asMap(normalizedVisitNotes);
    this.visitPhotos = this.asMap(await this.getAllFromStore<VisitPhotoRecord>("visitPhotos"));
    this.visitAttachments = this.asMap(await this.getAllFromStore<VisitAttachmentRecord>("visitAttachments"));
    this.generatedPdfs = this.asMap(await this.getAllFromStore<GeneratedPdfRecord>("generatedPdfs"));
    this.templates = this.asMap(await this.getAllFromStore<TemplateDefinitionRecord>("templates"));

    if (!settings) {
      this.queuePut("settings", this.settings);
      await this.flush();
    }
  }

  private async ensureTemplateDefaults() {
    const timestamp = nowIso();
    let templatesChanged = false;

    for (const defaultTemplate of DEFAULT_TEMPLATE_DEFINITIONS) {
      const existingTemplate = this.templates.get(defaultTemplate.id);
      if (!existingTemplate) {
        this.templates.set(defaultTemplate.id, {
          ...defaultTemplate,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        this.queuePut("templates", this.templates.get(defaultTemplate.id)!);
        templatesChanged = true;
        continue;
      }

      const nextTemplateText =
        existingTemplate.templateText === existingTemplate.defaultTemplateText
          ? defaultTemplate.templateText
          : existingTemplate.templateText;
      const updatedTemplate: TemplateDefinitionRecord = {
        ...existingTemplate,
        key: defaultTemplate.key,
        courseType: defaultTemplate.courseType,
        noteType: defaultTemplate.noteType,
        templateText: nextTemplateText,
        defaultTemplateText: defaultTemplate.defaultTemplateText,
        active: defaultTemplate.active,
        updatedAt:
          nextTemplateText !== existingTemplate.templateText ||
          defaultTemplate.defaultTemplateText !== existingTemplate.defaultTemplateText
            ? timestamp
            : existingTemplate.updatedAt
      };

      if (JSON.stringify(updatedTemplate) !== JSON.stringify(existingTemplate)) {
        this.templates.set(updatedTemplate.id, updatedTemplate);
        this.queuePut("templates", updatedTemplate);
        templatesChanged = true;
      }
    }

    if (templatesChanged) {
      await this.flush();
    }
  }

  private asMap<T extends { id: string }>(records: T[]) {
    return new Map(records.map((record) => [record.id, record]));
  }

  private async getAllFromStore<T>(storeName: BrowserStoreName): Promise<T[]> {
    const db = this.db;
    if (!db) {
      throw new Error("BrowserStructuredDataStore database is not ready.");
    }
    return this.runTransaction<T[]>(storeName, "readonly", (store) => store.getAll());
  }

  private async runTransaction<T>(
    storeName: BrowserStoreName,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T> | void
  ) {
    const db = this.db;
    if (!db) {
      throw new Error("BrowserStructuredDataStore database is not ready.");
    }

    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store) as IDBRequest<T> | void;

      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB request failed for ${storeName}.`));
      } else {
        transaction.oncomplete = () => resolve(undefined as T);
      }

      transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB transaction failed for ${storeName}.`));
      transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB transaction aborted for ${storeName}.`));
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const ensureStore = (name: BrowserStoreName, keyPath: string | string[]) => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath });
          }
        };

        ensureStore("settings", "id");
        ensureStore("savedOptions", "id");
        ensureStore("patients", "id");
        ensureStore("documentOnlyRecords", "id");
        ensureStore("documentOnlySites", "id");
        ensureStore("documentOnlyFiles", "id");
        ensureStore("courses", "id");
        ensureStore("sites", "id");
        ensureStore("courseDocuments", "id");
        ensureStore("visitNotes", "id");
        ensureStore("visitPhotos", "id");
        ensureStore("visitAttachments", "id");
        ensureStore("generatedPdfs", "id");
        ensureStore("templates", "id");
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    });
  }

  private deleteDatabase() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed."));
      request.onblocked = () => reject(new Error("IndexedDB delete was blocked."));
    });
  }
}
