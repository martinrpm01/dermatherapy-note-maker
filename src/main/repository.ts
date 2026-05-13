import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";

import { DEFAULT_TEMPLATE_DEFINITIONS } from "../shared/templates";
import type {
  AssetReference,
  AppSettingsRecord,
  AppSettingsView,
  CourseDocumentRecord,
  CourseInput,
  DocumentOnlyFileRecord,
  DocumentOnlyInput,
  DocumentOnlyRecord,
  DocumentOnlySiteInput,
  DocumentOnlySiteRecord,
  GeneratedPdfRecord,
  PatientInput,
  PatientRecord,
  ScheduleAppointmentInput,
  ScheduleAppointmentRecord,
  ScheduleAppointmentStatus,
  ScheduleIntakeSiteInput,
  ScheduleBlockInput,
  ScheduleBlockRecord,
  ScheduleSettingsView,
  SavedOptionRecord,
  SavedOptionType,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  TreatmentSiteInput,
  TreatmentSiteRecord,
  VisitAttachmentRecord,
  VisitInput,
  VisitNoteRecord,
  VisitPhotoRecord
} from "../shared/types";
import type {
  BinaryAssetStore,
  CourseAssetRecordSet,
  PersistedSettingsInput,
  PatientAssetRecordSet,
  StructuredDataStore,
  VisitAssetRecordSet
} from "../shared/storage";

type SqlValue = string | number | null;
const DEFAULT_APP_NAME = "ClearSkin Hub";

const require = createRequire(import.meta.url);
const sqlWasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");

function nowIso() {
  return new Date().toISOString();
}

function parseScheduleIntakeSites(value: string | null | undefined): ScheduleIntakeSiteInput[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as ScheduleIntakeSiteInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeScheduleIntakeSites(value: ScheduleIntakeSiteInput[] | null | undefined) {
  return JSON.stringify(value ?? []);
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function makeAssetId() {
  return `asset_${crypto.randomUUID()}`;
}

type AssetStoreRegistry = BinaryAssetStore & {
  registerStoredAssetReference?: (asset: AssetReference, filePath: string | null) => AssetReference | null;
};

export class RadiationNoteRepository implements StructuredDataStore {
  private sql!: SqlJsStatic;
  private db!: Database;

  readonly dataDir: string;
  readonly storageDir: string;
  readonly dbPath: string;

  constructor(
    readonly baseDir: string,
    private readonly assetStore: BinaryAssetStore
  ) {
    this.dataDir = path.join(baseDir, "data");
    this.storageDir = path.join(baseDir, "storage");
    this.dbPath = path.join(this.dataDir, "dermatherapy-note-maker.sqlite");
  }

  async initialize() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.storageDir, { recursive: true });

    this.sql = await initSqlJs({
      locateFile: () => sqlWasmPath
    });

    const existingBytes = fs.existsSync(this.dbPath) ? fs.readFileSync(this.dbPath) : undefined;
    this.db = existingBytes?.length ? new this.sql.Database(existingBytes) : new this.sql.Database();
    this.createSchema();
    this.seedDefaults();
    this.rebuildAssetReferenceIndex();
    this.persist();
  }

  getSettingsRecord() {
    return this.queryOne<AppSettingsRecord>(
      `SELECT
         id,
         app_name AS appName,
         pin_hash AS pinHash,
         pin_salt AS pinSalt,
         recovery_code_hash AS recoveryCodeHash,
         recovery_code_salt AS recoveryCodeSalt,
         default_therapist AS defaultTherapist,
         supervising_physician AS supervisingPhysician,
         dermatology_office_name AS dermatologyOfficeName,
         dermatology_office_logo_path AS dermatologyOfficeLogoPath,
         inactivity_timeout_minutes AS inactivityTimeoutMinutes,
         created_at AS createdAt,
         updated_at AS updatedAt
        FROM app_settings
        WHERE id = 1`
    )!;
  }

  private getSettingsAssetIdentity() {
    return this.queryOne<{ dermatologyOfficeLogoPath: string | null; dermatologyOfficeLogoAssetId: string | null }>(
      `SELECT
         dermatology_office_logo_path AS dermatologyOfficeLogoPath,
         dermatology_office_logo_asset_id AS dermatologyOfficeLogoAssetId
       FROM app_settings
       WHERE id = 1`
    );
  }

  toSettingsView(record: AppSettingsRecord): AppSettingsView {
    return {
      appName: record.appName,
      defaultTherapist: record.defaultTherapist,
      supervisingPhysician: record.supervisingPhysician ?? "",
      dermatologyOfficeName: record.dermatologyOfficeName ?? "",
      dermatologyOfficeLogoAsset: this.toAssetReference(record.dermatologyOfficeLogoPath ?? null, "settings_logo"),
      inactivityTimeoutMinutes: record.inactivityTimeoutMinutes
    };
  }

  private toAssetReference(
    filePath: string | null,
    kind: Parameters<BinaryAssetStore["createAssetReference"]>[1],
    assetId?: string | null
  ) {
    if (!filePath) {
      return null;
    }

    if (assetId) {
      const asset: AssetReference = { assetId, kind };
      const registry = this.assetStore as AssetStoreRegistry;
      if (registry.registerStoredAssetReference) {
        return registry.registerStoredAssetReference(asset, filePath);
      }
      return asset;
    }

    return this.assetStore.createAssetReference(filePath, kind);
  }

  private toPatientRecord(
    row: Omit<PatientRecord, "facePhoto"> & { facePhotoPath: string | null; facePhotoAssetId?: string | null }
  ): PatientRecord {
    const { facePhotoPath, facePhotoAssetId, ...patient } = row;
    return {
      ...patient,
      facePhoto: this.toAssetReference(facePhotoPath, "patient_face_photo", facePhotoAssetId)
    };
  }

  private toVisitPhotoRecord(
    row: Omit<VisitPhotoRecord, "imageAsset"> & { imagePath: string; imageAssetId?: string | null }
  ): VisitPhotoRecord {
    return {
      ...row,
      imageAsset: this.toAssetReference(row.imagePath, "visit_photo", row.imageAssetId)!
    };
  }

  private toVisitAttachmentRecord(
    row: Omit<VisitAttachmentRecord, "fileAsset"> & { filePath: string; fileAssetId?: string | null }
  ): VisitAttachmentRecord {
    return {
      ...row,
      fileAsset: this.toAssetReference(row.filePath, "visit_attachment", row.fileAssetId)!
    };
  }

  private toGeneratedPdfRecord(
    row: Omit<GeneratedPdfRecord, "fileAsset"> & { filePath: string; fileAssetId?: string | null }
  ): GeneratedPdfRecord {
    return {
      ...row,
      fileAsset: this.toAssetReference(row.filePath, "generated_pdf", row.fileAssetId)!
    };
  }

  private toCourseDocumentRecord(
    row: Omit<CourseDocumentRecord, "fileAsset"> & { filePath: string; fileAssetId?: string | null }
  ): CourseDocumentRecord {
    return {
      ...row,
      fileAsset: this.toAssetReference(row.filePath, "course_document", row.fileAssetId)!
    };
  }

  private toDocumentOnlyFileRecord(
    row: Omit<DocumentOnlyFileRecord, "fileAsset"> & { filePath: string; fileAssetId?: string | null }
  ): DocumentOnlyFileRecord {
    return {
      ...row,
      fileAsset: this.toAssetReference(row.filePath, "course_document", row.fileAssetId)!
    };
  }

  private toVisitNoteRecord(
    row: Omit<VisitNoteRecord, "vitals" | "structuredFields" | "pdfAsset"> & {
      vitalsJson: string;
      structuredFieldsJson: string;
      pdfPath: string | null;
      pdfAssetId?: string | null;
    }
  ): VisitNoteRecord {
    return {
      id: row.id,
      patientId: row.patientId,
      courseId: row.courseId,
      visitDate: row.visitDate,
      noteType: row.noteType,
      treatmentNumber: row.treatmentNumber,
      status: row.status,
      therapistName: row.therapistName,
      vitals: JSON.parse(row.vitalsJson),
      structuredFields: JSON.parse(row.structuredFieldsJson),
      generatedText: row.generatedText,
      editedText: row.editedText,
      pdfAsset: this.toAssetReference(row.pdfPath, "generated_pdf", row.pdfAssetId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  updatePin(hash: string, salt: string) {
    this.mutate(() => {
      this.run(
        `UPDATE app_settings
         SET pin_hash = ?, pin_salt = ?, updated_at = ?
         WHERE id = 1`,
        [hash, salt, nowIso()]
      );
    });
  }

  updateRecoveryCode(hash: string, salt: string) {
    this.mutate(() => {
      this.run(
        `UPDATE app_settings
         SET recovery_code_hash = ?, recovery_code_salt = ?, updated_at = ?
         WHERE id = 1`,
        [hash, salt, nowIso()]
      );
    });
  }

  updatePinAndRecovery(pinHash: string, pinSalt: string, recoveryCodeHash: string, recoveryCodeSalt: string) {
    this.mutate(() => {
      this.run(
        `UPDATE app_settings
         SET pin_hash = ?,
             pin_salt = ?,
             recovery_code_hash = ?,
             recovery_code_salt = ?,
             updated_at = ?
         WHERE id = 1`,
        [pinHash, pinSalt, recoveryCodeHash, recoveryCodeSalt, nowIso()]
      );
    });
  }

  wipeAllData() {
    if (this.db && "close" in this.db) {
      this.db.close();
    }

    if (fs.existsSync(this.dbPath)) {
      fs.rmSync(this.dbPath, { force: true });
    }

    this.db = new this.sql.Database();
    this.createSchema();
    this.seedDefaults();
    this.rebuildAssetReferenceIndex();
    this.persist();
  }

  updateSettings(input: PersistedSettingsInput) {
    const logoPath = input.dermatologyOfficeLogoAsset
      ? this.assetStore.resolveAssetPath(input.dermatologyOfficeLogoAsset)
      : (input.dermatologyOfficeLogoPath ?? null);
    const current = this.getSettingsAssetIdentity();
    const logoAssetId = this.resolveNextAssetId(
      current?.dermatologyOfficeLogoPath ?? null,
      current?.dermatologyOfficeLogoAssetId ?? null,
      logoPath
    );

    this.mutate(() => {
      this.run(
        `UPDATE app_settings
         SET app_name = ?, default_therapist = ?, supervising_physician = ?, dermatology_office_name = ?, dermatology_office_logo_path = ?, dermatology_office_logo_asset_id = ?, inactivity_timeout_minutes = ?, updated_at = ?
         WHERE id = 1`,
        [
          DEFAULT_APP_NAME,
          input.defaultTherapist.trim(),
          (input.supervisingPhysician ?? "").trim(),
          (input.dermatologyOfficeName ?? "").trim(),
          logoPath,
          logoAssetId,
          input.inactivityTimeoutMinutes,
          nowIso()
        ]
      );
    });
  }

  getSavedOptions() {
    return this.queryAll<SavedOptionRecord>(
      `SELECT
         id,
         type,
         value,
         normalized_value AS normalizedValue,
         active,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM saved_options
       WHERE active = 1
       ORDER BY type, value`
    ).map((option) => ({ ...option, active: Boolean(option.active) }));
  }

  deleteSavedOption(optionId: string) {
    this.mutate(() => {
      this.run(`UPDATE saved_options SET active = 0, updated_at = ? WHERE id = ?`, [nowIso(), optionId]);
    });
  }

  rememberOption(type: SavedOptionType, value: string, normalizedValue: string) {
    this.mutate(() => {
      const existing = this.queryOne<{ id: string }>(
        `SELECT id FROM saved_options WHERE type = ? AND normalized_value = ?`,
        [type, normalizedValue]
      );

      if (existing) {
        this.run(`UPDATE saved_options SET value = ?, active = 1, updated_at = ? WHERE id = ?`, [
          value,
          nowIso(),
          existing.id
        ]);
        return;
      }

      this.run(
        `INSERT INTO saved_options (id, type, value, normalized_value, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [makeId("option"), type, value, normalizedValue, nowIso(), nowIso()]
      );
    });
  }

  savePatient(input: PatientInput, facePhoto: AssetReference | string | null) {
      const patientId = input.id ?? makeId("patient");
      const existing = input.id ? this.fetchPatient(input.id) : null;
      const existingAsset = this.queryOne<{ facePhotoPath: string | null; facePhotoAssetId: string | null }>(
        `SELECT face_photo_path AS facePhotoPath, face_photo_asset_id AS facePhotoAssetId FROM patients WHERE id = ?`,
        [patientId]
      );
      const timestamp = nowIso();
      const facePhotoPath =
        typeof facePhoto === "string"
          ? facePhoto
          : this.assetStore.resolveAssetPath(facePhoto);
      const facePhotoAssetId = this.resolveNextAssetId(existingAsset?.facePhotoPath ?? null, existingAsset?.facePhotoAssetId ?? null, facePhotoPath);

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE patients
           SET first_name = ?, last_name = ?, mrn = ?, dob = ?, sex = ?, face_photo_path = ?, face_photo_asset_id = ?, notes = ?, updated_at = ?
            WHERE id = ?`,
          [
            input.firstName.trim(),
            input.lastName.trim(),
            input.mrn.trim(),
            input.dob,
            (input.sex ?? "").trim(),
            facePhotoPath,
            facePhotoAssetId,
            input.notes,
            timestamp,
            patientId
          ]
        );
      } else {
        this.run(
          `INSERT INTO patients (
            id, first_name, last_name, mrn, dob, sex, face_photo_path, face_photo_asset_id, status, notes, created_at, updated_at, archived_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
          [
            patientId,
            input.firstName.trim(),
            input.lastName.trim(),
            input.mrn.trim(),
            input.dob,
            (input.sex ?? "").trim(),
            facePhotoPath,
            facePhotoAssetId,
            input.notes,
            timestamp,
            timestamp
          ]
        );
      }
    });

    return this.fetchPatient(patientId)!;
  }

  setPatientStatus(patientId: string, status: PatientRecord["status"]) {
    const timestamp = nowIso();
    this.mutate(() => {
      this.run(`UPDATE patients SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?`, [
        status,
        status === "active" ? null : timestamp,
        timestamp,
        patientId
      ]);

      if (status !== "active") {
        this.run(
          `UPDATE treatment_courses
           SET status = 'archived', archived_at = ?, updated_at = ?
           WHERE patient_id = ? AND status IN ('active', 'pending')`,
          [timestamp, timestamp, patientId]
        );
        const courseIds = this.queryAll<{ id: string }>(`SELECT id FROM treatment_courses WHERE patient_id = ?`, [patientId]).map(
          (course) => course.id
        );
        const courseClause = courseIds.length ? ` OR course_id IN (${courseIds.map(() => "?").join(",")})` : "";
        this.run(`DELETE FROM schedule_appointments WHERE patient_id = ?${courseClause}`, [patientId, ...courseIds]);
      }
    });
  }

  fetchDocumentOnlyRecords(recordId?: string) {
    return this.queryAll<DocumentOnlyRecord>(
      `SELECT
         id,
         first_name AS firstName,
         last_name AS lastName,
         mrn,
         dob,
         sex,
         therapist_name AS therapistName,
         course_type AS courseType,
         biopsy_date AS biopsyDate,
         sim_consult_date AS simConsultDate,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM document_only_records
       ${recordId ? "WHERE id = ?" : ""}
       ORDER BY updated_at DESC, last_name ASC, first_name ASC`,
      recordId ? [recordId] : []
    );
  }

  fetchDocumentOnlySites(recordIds: string[]) {
    if (!recordIds.length) {
      return [] as DocumentOnlySiteRecord[];
    }

    return this.queryAll<DocumentOnlySiteRecord>(
      `SELECT
         id,
         record_id AS recordId,
         site_number AS siteNumber,
         body_location AS bodyLocation,
         treatment_location_text AS treatmentLocationText,
         diagnosis_text AS diagnosisText,
         biopsy_date AS biopsyDate,
         icd10,
         number_of_blocks AS numberOfBlocks,
         lesion_size AS lesionSize,
         treatment_depth AS treatmentDepth,
         cone_size AS coneSize,
         cutout_size AS cutoutSize,
         shields,
         machine,
         energy_kv AS energyKv,
         treatment_interval AS treatmentInterval,
         additional_devices AS additionalDevices,
         worksheet_side AS worksheetSide,
         worksheet_positioning AS worksheetPositioning,
         worksheet_vac_lok_area AS worksheetVacLokArea,
         worksheet_eye_shield_type AS worksheetEyeShieldType,
         worksheet_gum_shield_position AS worksheetGumShieldPosition,
         worksheet_lip_shield_position AS worksheetLipShieldPosition,
         daily_dose AS dailyDose,
         total_dose AS totalDose,
         projected_fractions AS projectedFractions,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM document_only_sites
       WHERE record_id IN (${this.placeholders(recordIds.length)})
       ORDER BY record_id ASC, site_number ASC`,
      recordIds
    );
  }

  fetchDocumentOnlyFiles(recordId: string) {
    return this.queryAll<
      Omit<DocumentOnlyFileRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }
    >(
      `SELECT
         id,
         record_id AS recordId,
         file_type AS fileType,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM document_only_files
       WHERE record_id = ?
       ORDER BY updated_at DESC, created_at DESC`,
      [recordId]
    ).map((row) => this.toDocumentOnlyFileRecord(row));
  }

  saveDocumentOnlyRecord(input: DocumentOnlyInput) {
    const recordId = input.id ?? makeId("document-only");
    const existing = input.id ? this.fetchDocumentOnlyRecords(input.id)[0] ?? null : null;
    const timestamp = nowIso();

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE document_only_records
           SET first_name = ?, last_name = ?, mrn = ?, dob = ?, sex = ?, therapist_name = ?, course_type = ?, biopsy_date = ?, sim_consult_date = ?, updated_at = ?
           WHERE id = ?`,
          [
            input.firstName.trim(),
            input.lastName.trim(),
            input.mrn.trim(),
            input.dob,
            input.sex.trim(),
            input.therapistName.trim(),
            input.courseType,
            input.biopsyDate,
            input.simConsultDate,
            timestamp,
            recordId
          ]
        );
      } else {
        this.run(
          `INSERT INTO document_only_records (
             id, first_name, last_name, mrn, dob, sex, therapist_name, course_type, biopsy_date, sim_consult_date, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            recordId,
            input.firstName.trim(),
            input.lastName.trim(),
            input.mrn.trim(),
            input.dob,
            input.sex.trim(),
            input.therapistName.trim(),
            input.courseType,
            input.biopsyDate,
            input.simConsultDate,
            timestamp,
            timestamp
          ]
        );
      }

      this.run(`DELETE FROM document_only_sites WHERE record_id = ?`, [recordId]);
      for (const site of input.sites) {
        this.insertDocumentOnlySite(recordId, site, timestamp);
      }
    });

    return this.fetchDocumentOnlyRecords(recordId)[0]!;
  }

  upsertDocumentOnlyFile(
    recordId: string,
    fileType: DocumentOnlyFileRecord["fileType"],
    filePath: string,
    caption: string,
    mimeType: string,
    originalName: string
  ) {
    const existing = this.queryOne<{ id: string; filePath: string | null; fileAssetId: string | null }>(
      `SELECT id, file_path AS filePath, file_asset_id AS fileAssetId
       FROM document_only_files
       WHERE record_id = ? AND file_type = ?
       LIMIT 1`,
      [recordId, fileType]
    );
    const fileAssetId = this.resolveNextAssetId(existing?.filePath ?? null, existing?.fileAssetId ?? null, filePath);
    const timestamp = nowIso();

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE document_only_files
           SET file_path = ?, file_asset_id = ?, caption = ?, mime_type = ?, original_name = ?, updated_at = ?
           WHERE id = ?`,
          [filePath, fileAssetId, caption, mimeType, originalName, timestamp, existing.id]
        );
      } else {
        this.run(
          `INSERT INTO document_only_files (
             id, record_id, file_type, file_path, file_asset_id, caption, mime_type, original_name, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [makeId("document-only-file"), recordId, fileType, filePath, fileAssetId, caption, mimeType, originalName, timestamp, timestamp]
        );
      }

      this.run(
        `UPDATE document_only_records
         SET updated_at = ?
         WHERE id = ?`,
        [timestamp, recordId]
      );
    });

    return this.fetchDocumentOnlyFiles(recordId).find((fileRecord) => fileRecord.fileType === fileType)!;
  }

  deleteDocumentOnlyFileRecord(fileId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM document_only_files WHERE id = ?`, [fileId]);
    });
  }

  deleteDocumentOnlyRecord(recordId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM document_only_files WHERE record_id = ?`, [recordId]);
      this.run(`DELETE FROM document_only_sites WHERE record_id = ?`, [recordId]);
      this.run(`DELETE FROM document_only_records WHERE id = ?`, [recordId]);
    });
  }

  hardDeletePatientRecords(patientId: string) {
    const courseIds = this.queryAll<{ id: string }>(
      `SELECT id FROM treatment_courses WHERE patient_id = ?`, [patientId]
    ).map((r) => r.id);
    const visitIds = courseIds.length
      ? this.queryAll<{ id: string }>(
          `SELECT id FROM visit_notes WHERE course_id IN (${this.placeholders(courseIds.length)})`, courseIds
        ).map((r) => r.id)
      : [];

    this.mutate(() => {
      if (courseIds.length) {
        const ph = this.placeholders(courseIds.length);

        if (visitIds.length) {
          const vph = this.placeholders(visitIds.length);
          this.run(`DELETE FROM generated_pdfs WHERE visit_note_id IN (${vph})`, visitIds);
          this.run(`DELETE FROM visit_attachments WHERE visit_note_id IN (${vph})`, visitIds);
          this.run(`DELETE FROM visit_photos WHERE visit_note_id IN (${vph})`, visitIds);
          this.run(`DELETE FROM visit_notes WHERE id IN (${vph})`, visitIds);
        }

        this.run(`DELETE FROM schedule_appointments WHERE course_id IN (${ph})`, courseIds);
        this.run(`DELETE FROM course_documents WHERE course_id IN (${ph})`, courseIds);
        this.run(`DELETE FROM treatment_sites WHERE course_id IN (${ph})`, courseIds);
        this.run(`DELETE FROM treatment_courses WHERE id IN (${ph})`, courseIds);
      }

      this.run(`DELETE FROM schedule_appointments WHERE patient_id = ?`, [patientId]);
      this.run(`DELETE FROM patients WHERE id = ?`, [patientId]);
    });
  }

  deleteCourseRecords(courseId: string) {
    const course = this.fetchCourse(courseId);
    if (!course) {
      return;
    }

    const visits = this.fetchVisitsByCourseIds([courseId]);
    const sites = this.fetchSites([courseId]);
    const documents = this.fetchCourseDocuments(courseId);

    this.mutate(() => {
      const visitIds = visits.map((visit) => visit.note.id);
      if (visitIds.length) {
        const placeholders = this.placeholders(visitIds.length);
        this.run(`DELETE FROM generated_pdfs WHERE visit_note_id IN (${placeholders})`, visitIds);
        this.run(`DELETE FROM visit_attachments WHERE visit_note_id IN (${placeholders})`, visitIds);
        this.run(`DELETE FROM visit_photos WHERE visit_note_id IN (${placeholders})`, visitIds);
        this.run(`DELETE FROM visit_notes WHERE id IN (${placeholders})`, visitIds);
      }

      if (sites.length) {
        this.run(`DELETE FROM treatment_sites WHERE course_id = ?`, [courseId]);
      }

      if (documents.length) {
        this.run(`DELETE FROM course_documents WHERE course_id = ?`, [courseId]);
      }

      this.run(`DELETE FROM schedule_appointments WHERE course_id = ?`, [courseId]);
      this.run(`DELETE FROM treatment_courses WHERE id = ?`, [courseId]);
    });
  }

  saveCourse(input: CourseInput) {
    const courseId = input.id ?? makeId("course");
    const existing = input.id ? this.fetchCourse(input.id) : null;
    const timestamp = nowIso();
    const status = input.status ?? existing?.status ?? "active";

    this.mutate(() => {
        if (existing) {
          this.run(
            `UPDATE treatment_courses
             SET course_name = ?, course_type = ?, prescribed_fractions = ?, status = ?, start_date = ?, sim_consult_date = ?, end_date = ?, updated_at = ?
             WHERE id = ?`,
            [
              input.courseName.trim(),
              input.courseType,
              input.prescribedFractions,
              status,
              input.startDate,
              input.simConsultDate?.trim() || null,
              input.endDate ?? null,
              timestamp,
              courseId
            ]
          );
        } else {
          this.run(
            `INSERT INTO treatment_courses (
              id, patient_id, course_name, course_type, prescribed_fractions, status, start_date, sim_consult_date, end_date, created_at, updated_at, archived_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              courseId,
              input.patientId,
              input.courseName.trim(),
              input.courseType,
              input.prescribedFractions,
              status,
              input.startDate,
              input.simConsultDate?.trim() || null,
              input.endDate ?? null,
              timestamp,
              timestamp
            ]
          );
      }

      this.run(`DELETE FROM treatment_sites WHERE course_id = ?`, [courseId]);
      for (const site of input.sites) {
        this.insertSite(courseId, site, timestamp);
      }
    });

    return this.fetchCourse(courseId)!;
  }

  fetchScheduleAppointments(startDate: string, endDate: string) {
    return this.queryAll<ScheduleAppointmentRecord & { intakeSitesJson: string }>(
      `SELECT
         id,
         patient_id AS patientId,
         course_id AS courseId,
         patient_name AS patientName,
         patient_first_name AS patientFirstName,
         patient_last_name AS patientLastName,
         patient_mrn AS patientMrn,
         patient_dob AS patientDob,
         patient_sex AS patientSex,
         appointment_date AS appointmentDate,
         start_time AS startTime,
         end_time AS endTime,
         appointment_type AS appointmentType,
         appointment_number AS appointmentNumber,
         total_appointments AS totalAppointments,
         status,
         notes,
         series_id AS seriesId,
         intake_course_type AS intakeCourseType,
         intake_biopsy_date AS intakeBiopsyDate,
         intake_sites_json AS intakeSitesJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM schedule_appointments
       WHERE appointment_date BETWEEN ? AND ?
       ORDER BY appointment_date ASC, start_time ASC, patient_name ASC`,
      [startDate, endDate]
    ).map(({ intakeSitesJson, ...appointment }) => ({
      ...appointment,
      intakeSites: parseScheduleIntakeSites(intakeSitesJson)
    }));
  }

  fetchScheduleAppointment(appointmentId: string) {
    const appointment = this.queryOne<ScheduleAppointmentRecord & { intakeSitesJson: string }>(
      `SELECT
         id,
         patient_id AS patientId,
         course_id AS courseId,
         patient_name AS patientName,
         patient_first_name AS patientFirstName,
         patient_last_name AS patientLastName,
         patient_mrn AS patientMrn,
         patient_dob AS patientDob,
         patient_sex AS patientSex,
         appointment_date AS appointmentDate,
         start_time AS startTime,
         end_time AS endTime,
         appointment_type AS appointmentType,
         appointment_number AS appointmentNumber,
         total_appointments AS totalAppointments,
         status,
         notes,
         series_id AS seriesId,
         intake_course_type AS intakeCourseType,
         intake_biopsy_date AS intakeBiopsyDate,
         intake_sites_json AS intakeSitesJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM schedule_appointments
       WHERE id = ?`,
      [appointmentId]
    );
    if (!appointment) {
      return null;
    }
    const { intakeSitesJson, ...record } = appointment;
    return {
      ...record,
      intakeSites: parseScheduleIntakeSites(intakeSitesJson)
    };
  }

  saveScheduleAppointment(input: ScheduleAppointmentInput) {
    const appointmentId = input.id ?? makeId("appt");
    const existing = input.id ? this.fetchScheduleAppointment(input.id) : null;
    const timestamp = nowIso();
    const record: ScheduleAppointmentRecord = {
      id: appointmentId,
      patientId: input.patientId ?? null,
      courseId: input.courseId ?? null,
      patientName: input.patientName.trim(),
      patientFirstName: input.patientFirstName?.trim() ?? existing?.patientFirstName ?? "",
      patientLastName: input.patientLastName?.trim() ?? existing?.patientLastName ?? "",
      patientMrn: input.patientMrn?.trim() ?? existing?.patientMrn ?? "",
      patientDob: input.patientDob?.trim() ?? existing?.patientDob ?? "",
      patientSex: input.patientSex?.trim() ?? existing?.patientSex ?? "",
      appointmentDate: input.appointmentDate,
      startTime: input.startTime,
      endTime: input.endTime,
      appointmentType: input.appointmentType,
      appointmentNumber: input.appointmentNumber ?? null,
      totalAppointments: input.totalAppointments ?? null,
      status: input.status ?? existing?.status ?? "scheduled",
      notes: input.notes?.trim() ?? existing?.notes ?? "",
      seriesId: input.seriesId ?? existing?.seriesId ?? null,
      intakeCourseType: input.intakeCourseType ?? existing?.intakeCourseType ?? null,
      intakeBiopsyDate: input.intakeBiopsyDate?.trim() ?? existing?.intakeBiopsyDate ?? "",
      intakeSites: input.intakeSites ?? existing?.intakeSites ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE schedule_appointments
           SET patient_id = ?, course_id = ?, patient_name = ?, patient_first_name = ?, patient_last_name = ?,
               patient_mrn = ?, patient_dob = ?, patient_sex = ?, appointment_date = ?, start_time = ?,
               end_time = ?, appointment_type = ?, appointment_number = ?, total_appointments = ?,
               status = ?, notes = ?, series_id = ?, intake_course_type = ?, intake_biopsy_date = ?,
               intake_sites_json = ?, updated_at = ?
           WHERE id = ?`,
          [
            record.patientId,
            record.courseId,
            record.patientName,
            record.patientFirstName,
            record.patientLastName,
            record.patientMrn,
            record.patientDob,
            record.patientSex,
            record.appointmentDate,
            record.startTime,
            record.endTime,
            record.appointmentType,
            record.appointmentNumber,
            record.totalAppointments,
            record.status,
            record.notes,
            record.seriesId,
            record.intakeCourseType,
            record.intakeBiopsyDate,
            serializeScheduleIntakeSites(record.intakeSites),
            record.updatedAt,
            record.id
          ]
        );
      } else {
        this.run(
          `INSERT INTO schedule_appointments (
             id, patient_id, course_id, patient_name, patient_first_name, patient_last_name,
             patient_mrn, patient_dob, patient_sex, appointment_date, start_time, end_time,
             appointment_type, appointment_number, total_appointments, status, notes, series_id,
             intake_course_type, intake_biopsy_date, intake_sites_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.patientId,
            record.courseId,
            record.patientName,
            record.patientFirstName,
            record.patientLastName,
            record.patientMrn,
            record.patientDob,
            record.patientSex,
            record.appointmentDate,
            record.startTime,
            record.endTime,
            record.appointmentType,
            record.appointmentNumber,
            record.totalAppointments,
            record.status,
            record.notes,
            record.seriesId,
            record.intakeCourseType,
            record.intakeBiopsyDate,
            serializeScheduleIntakeSites(record.intakeSites),
            record.createdAt,
            record.updatedAt
          ]
        );
      }
    });

    return this.fetchScheduleAppointment(appointmentId)!;
  }

  deleteScheduleAppointment(appointmentId: string) {
    this.mutate(() => {
      this.run("DELETE FROM schedule_appointments WHERE id = ?", [appointmentId]);
    });
  }

  deletePatientSchedule(patientId: string) {
    const courseIds = this.queryAll<{ id: string }>(`SELECT id FROM treatment_courses WHERE patient_id = ?`, [patientId]).map(
      (course) => course.id
    );
    const courseClause = courseIds.length ? ` OR course_id IN (${courseIds.map(() => "?").join(",")})` : "";
    const params = [patientId, ...courseIds];
    const count = this.scalar<number>(`SELECT COUNT(*) FROM schedule_appointments WHERE patient_id = ?${courseClause}`, params) ?? 0;
    if (count > 0) {
      this.mutate(() => {
        this.run(`DELETE FROM schedule_appointments WHERE patient_id = ?${courseClause}`, params);
      });
    }
    return count;
  }

  deleteCourseTreatmentSchedule(courseId: string) {
    const count =
      this.scalar<number>(
        `SELECT COUNT(*) FROM schedule_appointments WHERE course_id = ? AND appointment_type = 'treatment'`,
        [courseId]
      ) ?? 0;
    if (count > 0) {
      this.mutate(() => {
        this.run(`DELETE FROM schedule_appointments WHERE course_id = ? AND appointment_type = 'treatment'`, [courseId]);
      });
      this.syncCourseScheduleDates(courseId);
    }
    return count;
  }

  updateScheduleAppointmentStatus(appointmentId: string, status: ScheduleAppointmentStatus) {
    const appointment = this.fetchScheduleAppointment(appointmentId);
    if (!appointment) {
      throw new Error("Schedule appointment not found.");
    }

    return this.saveScheduleAppointment({ ...appointment, status });
  }

  fetchScheduleBlocks(startDate: string, endDate: string) {
    return this.queryAll<ScheduleBlockRecord & { recurringWeekdaysJson: string }>(
      `SELECT
         id,
         title,
         block_date AS blockDate,
         start_time AS startTime,
         end_time AS endTime,
         block_type AS blockType,
         is_recurring AS isRecurring,
         recurring_weekdays_json AS recurringWeekdaysJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM schedule_blocks
       WHERE block_date IS NULL OR block_date BETWEEN ? AND ?
       ORDER BY COALESCE(block_date, ''), start_time ASC, title ASC`,
      [startDate, endDate]
    ).map((block) => ({
      ...block,
      isRecurring: Boolean(block.isRecurring),
      recurringWeekdays: JSON.parse(block.recurringWeekdaysJson || "[]") as number[]
    }));
  }

  fetchScheduleBlock(blockId: string) {
    const block = this.queryOne<ScheduleBlockRecord & { recurringWeekdaysJson: string }>(
      `SELECT
         id,
         title,
         block_date AS blockDate,
         start_time AS startTime,
         end_time AS endTime,
         block_type AS blockType,
         is_recurring AS isRecurring,
         recurring_weekdays_json AS recurringWeekdaysJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM schedule_blocks
       WHERE id = ?`,
      [blockId]
    );

    return block
      ? {
          ...block,
          isRecurring: Boolean(block.isRecurring),
          recurringWeekdays: JSON.parse(block.recurringWeekdaysJson || "[]") as number[]
        }
      : null;
  }

  saveScheduleBlock(input: ScheduleBlockInput) {
    const blockId = input.id ?? makeId("block");
    const existing = input.id ? this.fetchScheduleBlock(input.id) : null;
    const timestamp = nowIso();
    const record: ScheduleBlockRecord = {
      id: blockId,
      title: input.title.trim(),
      blockDate: input.blockDate?.trim() || null,
      startTime: input.startTime,
      endTime: input.endTime,
      blockType: input.blockType,
      isRecurring: Boolean(input.isRecurring),
      recurringWeekdays: input.recurringWeekdays ?? existing?.recurringWeekdays ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE schedule_blocks
           SET title = ?, block_date = ?, start_time = ?, end_time = ?, block_type = ?,
               is_recurring = ?, recurring_weekdays_json = ?, updated_at = ?
           WHERE id = ?`,
          [
            record.title,
            record.blockDate,
            record.startTime,
            record.endTime,
            record.blockType,
            record.isRecurring ? 1 : 0,
            JSON.stringify(record.recurringWeekdays),
            record.updatedAt,
            record.id
          ]
        );
      } else {
        this.run(
          `INSERT INTO schedule_blocks (
             id, title, block_date, start_time, end_time, block_type, is_recurring,
             recurring_weekdays_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            record.title,
            record.blockDate,
            record.startTime,
            record.endTime,
            record.blockType,
            record.isRecurring ? 1 : 0,
            JSON.stringify(record.recurringWeekdays),
            record.createdAt,
            record.updatedAt
          ]
        );
      }
    });

    return this.fetchScheduleBlock(blockId)!;
  }

  deleteScheduleBlock(blockId: string) {
    this.mutate(() => {
      this.run("DELETE FROM schedule_blocks WHERE id = ?", [blockId]);
    });
  }

  getScheduleSettings(): ScheduleSettingsView {
    const record = this.queryOne<ScheduleSettingsView>(
      `SELECT clinic_start_time AS clinicStartTime, clinic_end_time AS clinicEndTime
       FROM schedule_settings
       WHERE id = 1`
    );

    return record ?? { clinicStartTime: "08:00", clinicEndTime: "17:00" };
  }

  saveScheduleSettings(input: ScheduleSettingsView): ScheduleSettingsView {
    const timestamp = nowIso();
    this.mutate(() => {
      this.run(
        `INSERT INTO schedule_settings (id, clinic_start_time, clinic_end_time, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           clinic_start_time = excluded.clinic_start_time,
           clinic_end_time = excluded.clinic_end_time,
           updated_at = excluded.updated_at`,
        [input.clinicStartTime, input.clinicEndTime, timestamp, timestamp]
      );
    });

    return this.getScheduleSettings();
  }

  updateCoursePrescribedFractions(courseId: string, prescribedFractions: number) {
    this.mutate(() => {
      this.run(
        `UPDATE treatment_courses
         SET prescribed_fractions = ?, updated_at = ?
         WHERE id = ?`,
        [prescribedFractions, nowIso(), courseId]
      );
    });
  }

  updateCourseSitePrescribedFractions(courseId: string, siteNumber: 1 | 2, prescribedFractions: number) {
    this.mutate(() => {
      this.run(
        `UPDATE treatment_sites
         SET prescribed_fractions = ?, updated_at = ?
         WHERE course_id = ? AND site_number = ?`,
        [prescribedFractions, nowIso(), courseId, siteNumber]
      );
    });
  }

  updateCourseSiteDoseValues(courseId: string, siteNumber: 1 | 2, dailyDose: number, totalDose: number) {
    this.mutate(() => {
      this.run(
        `UPDATE treatment_sites
         SET daily_dose = ?, total_dose = ?, updated_at = ?
         WHERE course_id = ? AND site_number = ?`,
        [dailyDose, totalDose, nowIso(), courseId, siteNumber]
      );
    });
  }

  getCourseScheduleDates(courseId: string) {
    const rows = this.queryAll<Pick<ScheduleAppointmentRecord, "appointmentDate" | "appointmentType">>(
      `SELECT appointment_date AS appointmentDate, appointment_type AS appointmentType
       FROM schedule_appointments
       WHERE course_id = ? AND status != 'cancelled'
       ORDER BY appointment_date ASC, start_time ASC`,
      [courseId]
    );
    return {
      simConsultDate: rows.find((row) => row.appointmentType === "sim_consult")?.appointmentDate ?? null,
      treatmentStartDate: rows.find((row) => row.appointmentType === "treatment")?.appointmentDate ?? null
    };
  }

  syncCourseScheduleDates(courseId: string) {
    const { simConsultDate, treatmentStartDate } = this.getCourseScheduleDates(courseId);
    const timestamp = nowIso();
    this.mutate(() => {
      if (simConsultDate) {
        this.run(
          `UPDATE treatment_courses
           SET sim_consult_date = ?, updated_at = ?
           WHERE id = ?`,
          [simConsultDate, timestamp, courseId]
        );
      }
      if (simConsultDate || treatmentStartDate) {
        const consultVisits = this.queryAll<{ id: string; structuredFieldsJson: string }>(
          `SELECT id, structured_fields_json AS structuredFieldsJson
           FROM visit_notes
           WHERE course_id = ? AND note_type = 'consult_sim'`,
          [courseId]
        );
        for (const visit of consultVisits) {
          const structuredFields = JSON.parse(visit.structuredFieldsJson) as VisitNoteRecord["structuredFields"];
          this.run(
            `UPDATE visit_notes
             SET visit_date = COALESCE(?, visit_date), structured_fields_json = ?, updated_at = ?
             WHERE id = ?`,
            [
              simConsultDate,
              JSON.stringify({
                ...structuredFields,
                startRadiationDate: treatmentStartDate ?? structuredFields.startRadiationDate ?? ""
              }),
              timestamp,
              visit.id
            ]
          );
        }
      }
    });
    return { simConsultDate, treatmentStartDate };
  }

  trimCourseTreatmentAppointments(courseId: string, prescribedFractions: number) {
    if (prescribedFractions <= 0) {
      return;
    }

    const appointments = this.fetchScheduleAppointments("0000-01-01", "9999-12-31")
      .filter((appointment) => appointment.courseId === courseId)
      .filter((appointment) => appointment.appointmentType === "treatment")
      .sort((left, right) =>
        `${left.appointmentDate}|${left.startTime}`.localeCompare(`${right.appointmentDate}|${right.startTime}`)
      );
    const extras = appointments.filter((appointment, index) => {
      if (appointment.status === "completed") {
        return false;
      }
      return (appointment.appointmentNumber ?? index + 1) > prescribedFractions || index >= prescribedFractions;
    });
    const extraIds = new Set(extras.map((appointment) => appointment.id));
    const retainedAppointments = appointments.filter((appointment) => !extraIds.has(appointment.id));
    const needsTotalUpdate = retainedAppointments.some(
      (appointment) =>
        (appointment.appointmentNumber ?? 0) <= prescribedFractions &&
        appointment.totalAppointments !== prescribedFractions
    );

    this.mutate(() => {
      if (needsTotalUpdate) {
        const timestamp = nowIso();
        for (const appointment of retainedAppointments) {
          if ((appointment.appointmentNumber ?? 0) <= prescribedFractions) {
            this.run(
              `UPDATE schedule_appointments
               SET total_appointments = ?, updated_at = ?
               WHERE id = ?`,
              [prescribedFractions, timestamp, appointment.id]
            );
          }
        }
      }
      for (const appointment of extras) {
        this.run("DELETE FROM schedule_appointments WHERE id = ?", [appointment.id]);
      }
    });
    if (extras.length || needsTotalUpdate) {
      this.syncCourseScheduleDates(courseId);
    }
  }

  setCourseStatus(courseId: string, status: TreatmentCourseRecord["status"], endDate: string | null = null) {
    const timestamp = nowIso();
    this.mutate(() => {
      this.run(
        `UPDATE treatment_courses
         SET status = ?, end_date = ?, archived_at = ?, updated_at = ?
         WHERE id = ?`,
        [status, endDate, status === "active" ? null : timestamp, timestamp, courseId]
      );
    });
  }

  saveVisit(input: VisitInput, generatedText: string, editedText: string) {
    const visitId = input.id ?? makeId("visit");
    const existing = input.id ? this.fetchVisit(visitId) : null;
    const timestamp = nowIso();

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE visit_notes
           SET visit_date = ?, note_type = ?, treatment_number = ?, status = ?, therapist_name = ?, vitals_json = ?, structured_fields_json = ?, generated_text = ?, edited_text = ?, updated_at = ?
           WHERE id = ?`,
          [
            input.visitDate,
            input.noteType,
            input.treatmentNumber,
            input.status,
            input.therapistName,
            JSON.stringify(input.vitals),
            JSON.stringify(input.structuredFields),
            generatedText,
            editedText,
            timestamp,
            visitId
          ]
        );
      } else {
        this.run(
          `INSERT INTO visit_notes (
            id, patient_id, course_id, visit_date, note_type, treatment_number, status, therapist_name, vitals_json,
            structured_fields_json, generated_text, edited_text, pdf_path, pdf_asset_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          [
            visitId,
            input.patientId,
            input.courseId,
            input.visitDate,
            input.noteType,
            input.treatmentNumber,
            input.status,
            input.therapistName,
            JSON.stringify(input.vitals),
            JSON.stringify(input.structuredFields),
            generatedText,
            editedText,
            timestamp,
            timestamp
          ]
        );
      }
    });

    return this.fetchVisit(visitId)!;
  }

  addVisitPhoto(visitId: string, image: AssetReference | string, sortOrder: number, caption: string) {
      const imagePath = typeof image === "string" ? image : this.assetStore.resolveAssetPath(image);
      const imageAssetId = typeof image === "string" ? makeAssetId() : image.assetId;
      this.mutate(() => {
        this.run(
          `INSERT INTO visit_photos (id, visit_note_id, image_path, image_asset_id, sort_order, caption, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [makeId("photo"), visitId, imagePath, imageAssetId, sortOrder, caption, nowIso()]
        );
      });
    }

  restoreVisitPhotoRecord(record: VisitPhotoRecord, image: AssetReference | string) {
      const imagePath = typeof image === "string" ? image : this.assetStore.resolveAssetPath(image);
      this.mutate(() => {
        this.run(
          `INSERT INTO visit_photos (id, visit_note_id, image_path, image_asset_id, sort_order, caption, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.visitNoteId, imagePath, record.imageAsset.assetId, record.sortOrder, record.caption, record.createdAt]
      );
    });
  }

  addVisitAttachment(
      visitId: string,
      file: AssetReference | string,
      sortOrder: number,
      caption: string,
      mimeType: string,
      originalName: string
    ) {
      const filePath = typeof file === "string" ? file : this.assetStore.resolveAssetPath(file);
      const fileAssetId = typeof file === "string" ? makeAssetId() : file.assetId;
      this.mutate(() => {
        this.run(
          `INSERT INTO visit_attachments (id, visit_note_id, file_path, file_asset_id, sort_order, caption, mime_type, original_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [makeId("attachment"), visitId, filePath, fileAssetId, sortOrder, caption, mimeType, originalName, nowIso()]
      );
    });
  }

  restoreVisitAttachmentRecord(record: VisitAttachmentRecord, file: AssetReference | string) {
      const filePath = typeof file === "string" ? file : this.assetStore.resolveAssetPath(file);
      this.mutate(() => {
        this.run(
          `INSERT INTO visit_attachments (id, visit_note_id, file_path, file_asset_id, sort_order, caption, mime_type, original_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.visitNoteId,
          filePath,
          record.fileAsset.assetId,
          record.sortOrder,
          record.caption,
          record.mimeType,
          record.originalName,
          record.createdAt
        ]
      );
    });
  }

  deleteVisitPhotoRecord(photoId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM visit_photos WHERE id = ?`, [photoId]);
    });
  }

  deleteVisitAttachmentRecord(attachmentId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM visit_attachments WHERE id = ?`, [attachmentId]);
    });
  }

  deleteGeneratedPdfRecord(pdfId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM generated_pdfs WHERE id = ?`, [pdfId]);
    });
  }

  upsertCourseDocument(
    courseId: string,
    documentType: CourseDocumentRecord["documentType"],
    file: AssetReference | string,
    caption: string,
    mimeType: string,
    originalName: string
  ) {
    const filePath = typeof file === "string" ? file : this.assetStore.resolveAssetPath(file);
    const existing = this.queryOne<{ id: string; filePath: string | null; fileAssetId: string | null; createdAt: string }>(
      `SELECT
         id,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         created_at AS createdAt
       FROM course_documents
       WHERE course_id = ?
         AND document_type = ?
       LIMIT 1`,
      [courseId, documentType]
    );
    const fileAssetId =
      typeof file === "string"
        ? this.resolveNextAssetId(existing?.filePath ?? null, existing?.fileAssetId ?? null, filePath)
        : file.assetId;
    const timestamp = nowIso();

    this.mutate(() => {
      if (existing) {
        this.run(
          `UPDATE course_documents
           SET file_path = ?, file_asset_id = ?, caption = ?, mime_type = ?, original_name = ?, updated_at = ?
           WHERE id = ?`,
          [filePath, fileAssetId, caption, mimeType, originalName, timestamp, existing.id]
        );
        return;
      }

      this.run(
        `INSERT INTO course_documents (
           id,
           course_id,
           document_type,
           file_path,
           file_asset_id,
           caption,
           mime_type,
           original_name,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [makeId("course-document"), courseId, documentType, filePath, fileAssetId, caption, mimeType, originalName, timestamp, timestamp]
      );
    });

    return this.fetchCourseDocuments(courseId).find((document) => document.documentType === documentType)!;
  }

  deleteCourseDocumentRecord(documentId: string) {
    this.mutate(() => {
      this.run(`DELETE FROM course_documents WHERE id = ?`, [documentId]);
    });
  }

  deleteVisitRecords(visitId: string) {
    const visit = this.fetchVisit(visitId);
    if (!visit) {
      return;
    }

    this.mutate(() => {
      this.run(`DELETE FROM generated_pdfs WHERE visit_note_id = ?`, [visitId]);
      this.run(`DELETE FROM visit_attachments WHERE visit_note_id = ?`, [visitId]);
      this.run(`DELETE FROM visit_photos WHERE visit_note_id = ?`, [visitId]);
      this.run(`DELETE FROM visit_notes WHERE id = ?`, [visitId]);
    });
  }

  insertGeneratedPdf(visitId: string, file: AssetReference | string, versionNumber: number) {
      const filePath = typeof file === "string" ? file : this.assetStore.resolveAssetPath(file);
      const fileAssetId = typeof file === "string" ? makeAssetId() : file.assetId;
      this.mutate(() => {
        this.run(
          `INSERT INTO generated_pdfs (id, visit_note_id, file_path, file_asset_id, version_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        [makeId("pdf"), visitId, filePath, fileAssetId, versionNumber, nowIso()]
      );
      this.run(`UPDATE visit_notes SET pdf_path = ?, pdf_asset_id = ?, updated_at = ? WHERE id = ?`, [
        filePath,
        fileAssetId,
        nowIso(),
        visitId
      ]);
    });
  }

  restoreGeneratedPdfRecord(record: GeneratedPdfRecord, file: AssetReference | string) {
      const filePath = typeof file === "string" ? file : this.assetStore.resolveAssetPath(file);
      this.mutate(() => {
        this.run(
          `INSERT INTO generated_pdfs (id, visit_note_id, file_path, file_asset_id, version_number, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        [record.id, record.visitNoteId, filePath, record.fileAsset.assetId, record.versionNumber, record.createdAt]
      );
      this.run(`UPDATE visit_notes SET pdf_path = ?, pdf_asset_id = ?, updated_at = ? WHERE id = ?`, [
        filePath,
        record.fileAsset.assetId,
        nowIso(),
        record.visitNoteId
      ]);
    });
  }

  getTemplates() {
    return this.queryAll<TemplateDefinitionRecord>(
      `SELECT
         id,
         key,
         course_type AS courseType,
         note_type AS noteType,
         template_text AS templateText,
         default_template_text AS defaultTemplateText,
         active,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM template_definitions
       ORDER BY key ASC`
    ).map((template) => ({ ...template, active: Boolean(template.active) }));
  }

  getTemplate(templateIdOrKey: string) {
    const template = this.queryOne<TemplateDefinitionRecord>(
      `SELECT
         id,
         key,
         course_type AS courseType,
         note_type AS noteType,
         template_text AS templateText,
         default_template_text AS defaultTemplateText,
         active,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM template_definitions
       WHERE id = ? OR key = ?`,
      [templateIdOrKey, templateIdOrKey]
    );

    return template ? { ...template, active: Boolean(template.active) } : null;
  }

  saveTemplate(templateId: string, templateText: string) {
    this.mutate(() => {
      this.run(`UPDATE template_definitions SET template_text = ?, updated_at = ? WHERE id = ?`, [
        templateText.trim(),
        nowIso(),
        templateId
      ]);
    });
    return this.getTemplate(templateId)!;
  }

  resetTemplate(templateId: string) {
    this.mutate(() => {
      this.run(
        `UPDATE template_definitions SET template_text = default_template_text, updated_at = ? WHERE id = ?`,
        [nowIso(), templateId]
      );
    });
    return this.getTemplate(templateId)!;
  }

  rewriteStoredPathPrefix(fromPrefix: string, toPrefix: string) {
    if (!fromPrefix || !toPrefix || fromPrefix === toPrefix) {
      return;
    }

    const likePattern = `${fromPrefix}%`;
    this.mutate(() => {
      this.run(
        `UPDATE patients
         SET face_photo_path = REPLACE(face_photo_path, ?, ?)
         WHERE face_photo_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
      this.run(
        `UPDATE visit_photos
         SET image_path = REPLACE(image_path, ?, ?)
         WHERE image_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
      this.run(
        `UPDATE generated_pdfs
         SET file_path = REPLACE(file_path, ?, ?)
         WHERE file_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
      this.run(
        `UPDATE course_documents
         SET file_path = REPLACE(file_path, ?, ?)
         WHERE file_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
      this.run(
        `UPDATE document_only_files
         SET file_path = REPLACE(file_path, ?, ?)
         WHERE file_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
      this.run(
        `UPDATE visit_notes
         SET pdf_path = REPLACE(pdf_path, ?, ?)
         WHERE pdf_path LIKE ?`,
        [fromPrefix, toPrefix, likePattern]
      );
    });
  }

  fetchPatients(whereClause = "1 = 1", params: SqlValue[] = []) {
    return this.queryAll<Omit<PatientRecord, "facePhoto"> & { facePhotoPath: string | null; facePhotoAssetId: string | null }>(
      `SELECT
         id,
         first_name AS firstName,
         last_name AS lastName,
         mrn,
         dob,
         sex,
         face_photo_path AS facePhotoPath,
         face_photo_asset_id AS facePhotoAssetId,
         status,
         notes,
         created_at AS createdAt,
         updated_at AS updatedAt,
         archived_at AS archivedAt
       FROM patients
       WHERE ${whereClause}
       ORDER BY last_name, first_name`,
      params
    ).map((row) => this.toPatientRecord(row));
  }

  fetchPatient(patientId: string) {
    const row = this.queryOne<Omit<PatientRecord, "facePhoto"> & { facePhotoPath: string | null; facePhotoAssetId: string | null }>(
      `SELECT
         id,
         first_name AS firstName,
         last_name AS lastName,
         mrn,
         dob,
         sex,
         face_photo_path AS facePhotoPath,
         face_photo_asset_id AS facePhotoAssetId,
         status,
         notes,
         created_at AS createdAt,
         updated_at AS updatedAt,
         archived_at AS archivedAt
       FROM patients
       WHERE id = ?`,
      [patientId]
    );
    return row ? this.toPatientRecord(row) : null;
  }

  fetchCourses(whereClause = "1 = 1", params: SqlValue[] = []) {
    return this.queryAll<TreatmentCourseRecord>(
      `SELECT
         id,
         patient_id AS patientId,
         course_name AS courseName,
         course_type AS courseType,
         prescribed_fractions AS prescribedFractions,
         status,
         start_date AS startDate,
         sim_consult_date AS simConsultDate,
         end_date AS endDate,
         created_at AS createdAt,
         updated_at AS updatedAt,
         archived_at AS archivedAt
       FROM treatment_courses
       WHERE ${whereClause}
       ORDER BY start_date DESC, course_name ASC`,
      params
    );
  }

  fetchCourse(courseId: string) {
    return this.queryOne<TreatmentCourseRecord>(
      `SELECT
         id,
         patient_id AS patientId,
         course_name AS courseName,
           course_type AS courseType,
           prescribed_fractions AS prescribedFractions,
           status,
           start_date AS startDate,
           sim_consult_date AS simConsultDate,
           end_date AS endDate,
           created_at AS createdAt,
           updated_at AS updatedAt,
           archived_at AS archivedAt
       FROM treatment_courses
       WHERE id = ?`,
      [courseId]
    );
  }

  fetchSites(courseIds: string[]) {
    if (!courseIds.length) {
      return [] as TreatmentSiteRecord[];
    }

    return this.queryAll<TreatmentSiteRecord>(
      `SELECT
         id,
         course_id AS courseId,
         site_number AS siteNumber,
         body_location AS bodyLocation,
         treatment_location_text AS treatmentLocationText,
         diagnosis_text AS diagnosisText,
         biopsy_date AS biopsyDate,
         icd10,
         number_of_blocks AS numberOfBlocks,
         lesion_size AS lesionSize,
         treatment_depth AS treatmentDepth,
         cone_size AS coneSize,
         cutout_size AS cutoutSize,
         shields,
         machine,
         energy_kv AS energyKv,
         treatment_interval AS treatmentInterval,
         additional_devices AS additionalDevices,
         worksheet_side AS worksheetSide,
         worksheet_positioning AS worksheetPositioning,
         worksheet_vac_lok_area AS worksheetVacLokArea,
         worksheet_eye_shield_type AS worksheetEyeShieldType,
         worksheet_gum_shield_position AS worksheetGumShieldPosition,
         worksheet_lip_shield_position AS worksheetLipShieldPosition,
         daily_dose AS dailyDose,
         total_dose AS totalDose,
         prescribed_fractions AS prescribedFractions,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM treatment_sites
       WHERE course_id IN (${this.placeholders(courseIds.length)})
       ORDER BY site_number ASC`,
      courseIds
    );
  }

  fetchCourseDocuments(courseId: string) {
    return this.queryAll<
      Omit<CourseDocumentRecord, "fileAsset"> & {
        filePath: string;
        fileAssetId: string | null;
      }
    >(
      `SELECT
         id,
         course_id AS courseId,
         document_type AS documentType,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM course_documents
       WHERE course_id = ?
       ORDER BY created_at ASC`,
      [courseId]
    ).map((row) => this.toCourseDocumentRecord(row));
  }

  fetchCourseDocument(documentId: string) {
    const row = this.queryOne<
      Omit<CourseDocumentRecord, "fileAsset"> & {
        filePath: string;
        fileAssetId: string | null;
      }
    >(
      `SELECT
         id,
         course_id AS courseId,
         document_type AS documentType,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM course_documents
       WHERE id = ?`,
      [documentId]
    );

    return row ? this.toCourseDocumentRecord(row) : null;
  }

  fetchVisit(visitId: string) {
    const row = this.queryOne<{
      id: string;
      patientId: string;
      courseId: string;
      visitDate: string;
      noteType: VisitNoteRecord["noteType"];
      treatmentNumber: number | null;
      status: VisitNoteRecord["status"];
      therapistName: string;
      vitalsJson: string;
      structuredFieldsJson: string;
      generatedText: string;
      editedText: string;
      pdfPath: string | null;
      pdfAssetId: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT
         id,
         patient_id AS patientId,
         course_id AS courseId,
         visit_date AS visitDate,
         note_type AS noteType,
         treatment_number AS treatmentNumber,
         status,
         therapist_name AS therapistName,
         vitals_json AS vitalsJson,
         structured_fields_json AS structuredFieldsJson,
         generated_text AS generatedText,
         edited_text AS editedText,
         pdf_path AS pdfPath,
         pdf_asset_id AS pdfAssetId,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM visit_notes
       WHERE id = ?`,
      [visitId]
    );

    return row ? this.mapVisit(row) : null;
  }

  fetchVisitsByCourseIds(courseIds: string[]) {
    if (!courseIds.length) {
      return [] as Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>;
    }

    const visits = this.queryAll<{
      id: string;
      patientId: string;
      courseId: string;
      visitDate: string;
      noteType: VisitNoteRecord["noteType"];
      treatmentNumber: number | null;
      status: VisitNoteRecord["status"];
      therapistName: string;
      vitalsJson: string;
      structuredFieldsJson: string;
      generatedText: string;
      editedText: string;
      pdfPath: string | null;
      pdfAssetId: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT
         id,
         patient_id AS patientId,
         course_id AS courseId,
         visit_date AS visitDate,
         note_type AS noteType,
         treatment_number AS treatmentNumber,
         status,
         therapist_name AS therapistName,
         vitals_json AS vitalsJson,
         structured_fields_json AS structuredFieldsJson,
         generated_text AS generatedText,
         edited_text AS editedText,
         pdf_path AS pdfPath,
         pdf_asset_id AS pdfAssetId,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM visit_notes
       WHERE course_id IN (${this.placeholders(courseIds.length)})
       ORDER BY COALESCE(treatment_number, 0) ASC, visit_date ASC, created_at ASC`,
      courseIds
    );

    return this.attachVisitChildren(visits);
  }

  fetchVisitsByPatientIds(patientIds: string[]) {
    if (!patientIds.length) {
      return [] as Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>;
    }

    const visits = this.queryAll<{
      id: string;
      patientId: string;
      courseId: string;
      visitDate: string;
      noteType: VisitNoteRecord["noteType"];
      treatmentNumber: number | null;
      status: VisitNoteRecord["status"];
      therapistName: string;
      vitalsJson: string;
      structuredFieldsJson: string;
      generatedText: string;
      editedText: string;
      pdfPath: string | null;
      pdfAssetId: string | null;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT
         id,
         patient_id AS patientId,
         course_id AS courseId,
         visit_date AS visitDate,
         note_type AS noteType,
         treatment_number AS treatmentNumber,
         status,
         therapist_name AS therapistName,
         vitals_json AS vitalsJson,
         structured_fields_json AS structuredFieldsJson,
         generated_text AS generatedText,
         edited_text AS editedText,
         pdf_path AS pdfPath,
         pdf_asset_id AS pdfAssetId,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM visit_notes
       WHERE patient_id IN (${this.placeholders(patientIds.length)})
       ORDER BY COALESCE(treatment_number, 0) ASC, visit_date ASC, created_at ASC`,
      patientIds
    );

    return this.attachVisitChildren(visits);
  }

  fetchVisitPhotos(visitId: string) {
    return this.queryAll<Omit<VisitPhotoRecord, "imageAsset"> & { imagePath: string; imageAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         image_path AS imagePath,
         image_asset_id AS imageAssetId,
         sort_order AS sortOrder,
         caption,
         created_at AS createdAt
       FROM visit_photos
       WHERE visit_note_id = ?
       ORDER BY sort_order ASC`,
      [visitId]
    ).map((row) => this.toVisitPhotoRecord(row));
  }

  fetchVisitPhoto(photoId: string) {
    const row = this.queryOne<Omit<VisitPhotoRecord, "imageAsset"> & { imagePath: string; imageAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         image_path AS imagePath,
         image_asset_id AS imageAssetId,
         sort_order AS sortOrder,
         caption,
         created_at AS createdAt
       FROM visit_photos
       WHERE id = ?`,
      [photoId]
    );
    return row ? this.toVisitPhotoRecord(row) : null;
  }

  fetchVisitAttachments(visitId: string) {
    return this.queryAll<Omit<VisitAttachmentRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         sort_order AS sortOrder,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt
       FROM visit_attachments
       WHERE visit_note_id = ?
       ORDER BY sort_order ASC`,
      [visitId]
    ).map((row) => this.toVisitAttachmentRecord(row));
  }

  fetchVisitAttachment(attachmentId: string) {
    const row = this.queryOne<Omit<VisitAttachmentRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         sort_order AS sortOrder,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt
       FROM visit_attachments
       WHERE id = ?`,
      [attachmentId]
    );
    return row ? this.toVisitAttachmentRecord(row) : null;
  }

  fetchGeneratedPdfs(visitId: string) {
    return this.queryAll<Omit<GeneratedPdfRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         version_number AS versionNumber,
         created_at AS createdAt
       FROM generated_pdfs
       WHERE visit_note_id = ?
       ORDER BY version_number DESC`,
      [visitId]
    ).map((row) => this.toGeneratedPdfRecord(row));
  }

  getVisitAssetRecordSet(visitId: string): VisitAssetRecordSet | null {
    const visit = this.fetchVisit(visitId);
    if (!visit) {
      return null;
    }

    return {
      note: visit,
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
    const patient = this.fetchPatient(patientId);
    const courses = this.fetchCourses("patient_id = ?", [patientId]).map((course) => ({
      course,
      documents: this.fetchCourseDocuments(course.id),
      visits: this.fetchVisitsByCourseIds([course.id])
    }));

    return {
      patient,
      courses
    };
  }

  fetchCompletedPatientIds() {
    return this.queryAll<{ id: string }>(
      `SELECT DISTINCT p.id AS id
       FROM patients p
       INNER JOIN treatment_courses c ON c.patient_id = p.id
       WHERE p.status = 'active'
         AND EXISTS (
           SELECT 1
           FROM treatment_courses completed_course
           WHERE completed_course.patient_id = p.id
             AND completed_course.status = 'completed'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM treatment_courses active_course
           WHERE active_course.patient_id = p.id
             AND active_course.status IN ('active', 'pending')
         )
       ORDER BY p.last_name, p.first_name`
    ).map((row) => row.id);
  }

  fetchArchivePatientIds() {
    return this.queryAll<{ id: string }>(
      `SELECT DISTINCT p.id AS id
       FROM patients p
       WHERE p.status = 'archived'
       ORDER BY p.last_name, p.first_name`
    ).map((row) => row.id);
  }

  countPatients(whereClause: string, params: SqlValue[] = []) {
    return this.scalar<number>(`SELECT COUNT(*) AS count FROM patients WHERE ${whereClause}`, params) ?? 0;
  }

  countCourses(whereClause: string, params: SqlValue[] = []) {
    return this.scalar<number>(`SELECT COUNT(*) AS count FROM treatment_courses WHERE ${whereClause}`, params) ?? 0;
  }

  loadPatientDetails(patientIds: string[]) {
    if (!patientIds.length) {
      return [] as Array<{
        patient: PatientRecord;
        courses: Array<{
          course: TreatmentCourseRecord;
          sites: TreatmentSiteRecord[];
          documents: CourseDocumentRecord[];
          visits: Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>;
        }>;
      }>;
    }

    const patients = this.fetchPatients(`id IN (${this.placeholders(patientIds.length)})`, patientIds);
    const courses = this.fetchCourses(`patient_id IN (${this.placeholders(patientIds.length)})`, patientIds);
    const sites = this.fetchSites(courses.map((course) => course.id));
    const documents = courses.flatMap((course) => this.fetchCourseDocuments(course.id));
    const visits = this.fetchVisitsByPatientIds(patientIds);

    const patientMap = new Map(patients.map((patient) => [patient.id, patient]));
    const coursesByPatient = new Map<string, TreatmentCourseRecord[]>();
    const sitesByCourse = new Map<string, TreatmentSiteRecord[]>();
    const documentsByCourse = new Map<string, CourseDocumentRecord[]>();
    const visitsByCourse = new Map<
      string,
      Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>
    >();

    for (const course of courses) {
      const list = coursesByPatient.get(course.patientId) || [];
      list.push(course);
      list.sort((left, right) => right.startDate.localeCompare(left.startDate));
      coursesByPatient.set(course.patientId, list);
    }

    for (const site of sites) {
      const list = sitesByCourse.get(site.courseId) || [];
      list.push(site);
      list.sort((left, right) => left.siteNumber - right.siteNumber);
      sitesByCourse.set(site.courseId, list);
    }

    for (const document of documents) {
      const list = documentsByCourse.get(document.courseId) || [];
      list.push(document);
      list.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      documentsByCourse.set(document.courseId, list);
    }

    for (const visit of visits) {
      const list = visitsByCourse.get(visit.note.courseId) || [];
      list.push(visit);
      list.sort((left, right) => {
        const treatmentComparison = (left.note.treatmentNumber ?? 0) - (right.note.treatmentNumber ?? 0);
        if (treatmentComparison !== 0) {
          return treatmentComparison;
        }

        const dateComparison = left.note.visitDate.localeCompare(right.note.visitDate);
        if (dateComparison !== 0) {
          return dateComparison;
        }

        return left.note.createdAt.localeCompare(right.note.createdAt);
      });
      visitsByCourse.set(visit.note.courseId, list);
    }

    return patientIds
      .map((patientId) => {
        const patient = patientMap.get(patientId);
        if (!patient) {
          return null;
        }

        return {
          patient,
          courses: (coursesByPatient.get(patient.id) || []).map((course) => ({
            course,
            sites: sitesByCourse.get(course.id) || [],
            documents: documentsByCourse.get(course.id) || [],
            visits: visitsByCourse.get(course.id) || []
          }))
        };
      })
      .filter(Boolean) as Array<{
      patient: PatientRecord;
      courses: Array<{
        course: TreatmentCourseRecord;
        sites: TreatmentSiteRecord[];
        documents: CourseDocumentRecord[];
        visits: Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>;
      }>;
    }>;
  }

  loadDocumentOnlyDetails(recordIds?: string[]) {
    const filteredRecordIds = recordIds?.length ? recordIds : this.fetchDocumentOnlyRecords().map((record) => record.id);
    if (!filteredRecordIds.length) {
      return [] as Array<{
        record: DocumentOnlyRecord;
        sites: DocumentOnlySiteRecord[];
        files: DocumentOnlyFileRecord[];
      }>;
    }

    const recordMap = new Map(this.fetchDocumentOnlyRecords().map((record) => [record.id, record]));
    const sites = this.fetchDocumentOnlySites(filteredRecordIds);
    const sitesByRecord = new Map<string, DocumentOnlySiteRecord[]>();
    for (const site of sites) {
      const list = sitesByRecord.get(site.recordId) || [];
      list.push(site);
      list.sort((left, right) => left.siteNumber - right.siteNumber);
      sitesByRecord.set(site.recordId, list);
    }

    return filteredRecordIds
      .map((recordId) => {
        const record = recordMap.get(recordId);
        if (!record) {
          return null;
        }

        return {
          record,
          sites: sitesByRecord.get(recordId) || [],
          files: this.fetchDocumentOnlyFiles(recordId)
        };
      })
      .filter(Boolean) as Array<{
      record: DocumentOnlyRecord;
      sites: DocumentOnlySiteRecord[];
      files: DocumentOnlyFileRecord[];
    }>;
  }

  private attachVisitChildren(
    visits: Array<{
      id: string;
      patientId: string;
      courseId: string;
      visitDate: string;
      noteType: VisitNoteRecord["noteType"];
      treatmentNumber: number | null;
      status: VisitNoteRecord["status"];
      therapistName: string;
      vitalsJson: string;
      structuredFieldsJson: string;
      generatedText: string;
      editedText: string;
      pdfPath: string | null;
      pdfAssetId: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  ) {
    const visitIds = visits.map((visit) => visit.id);
    if (!visitIds.length) {
      return [] as Array<{ note: VisitNoteRecord; photos: VisitPhotoRecord[]; attachments: VisitAttachmentRecord[]; pdfs: GeneratedPdfRecord[] }>;
    }

    const photos = this.queryAll<Omit<VisitPhotoRecord, "imageAsset"> & { imagePath: string; imageAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         image_path AS imagePath,
         image_asset_id AS imageAssetId,
         sort_order AS sortOrder,
         caption,
         created_at AS createdAt
       FROM visit_photos
       WHERE visit_note_id IN (${this.placeholders(visitIds.length)})
       ORDER BY sort_order ASC`,
      visitIds
    );

    const pdfs = this.queryAll<Omit<GeneratedPdfRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         version_number AS versionNumber,
         created_at AS createdAt
       FROM generated_pdfs
       WHERE visit_note_id IN (${this.placeholders(visitIds.length)})
       ORDER BY version_number DESC`,
      visitIds
    );

    const attachments = this.queryAll<Omit<VisitAttachmentRecord, "fileAsset"> & { filePath: string; fileAssetId: string | null }>(
      `SELECT
         id,
         visit_note_id AS visitNoteId,
         file_path AS filePath,
         file_asset_id AS fileAssetId,
         sort_order AS sortOrder,
         caption,
         mime_type AS mimeType,
         original_name AS originalName,
         created_at AS createdAt
       FROM visit_attachments
       WHERE visit_note_id IN (${this.placeholders(visitIds.length)})
       ORDER BY sort_order ASC`,
      visitIds
    );

    const photosByVisit = new Map<string, VisitPhotoRecord[]>();
    const attachmentsByVisit = new Map<string, VisitAttachmentRecord[]>();
    const pdfsByVisit = new Map<string, GeneratedPdfRecord[]>();

    for (const photo of photos) {
      const mapped = this.toVisitPhotoRecord(photo);
      const list = photosByVisit.get(mapped.visitNoteId) || [];
      list.push(mapped);
      photosByVisit.set(mapped.visitNoteId, list);
    }

    for (const pdf of pdfs) {
      const mapped = this.toGeneratedPdfRecord(pdf);
      const list = pdfsByVisit.get(mapped.visitNoteId) || [];
      list.push(mapped);
      pdfsByVisit.set(mapped.visitNoteId, list);
    }

    for (const attachment of attachments) {
      const mapped = this.toVisitAttachmentRecord(attachment);
      const list = attachmentsByVisit.get(mapped.visitNoteId) || [];
      list.push(mapped);
      attachmentsByVisit.set(mapped.visitNoteId, list);
    }

    return visits.map((visit) => ({
      note: this.mapVisit(visit),
      photos: photosByVisit.get(visit.id) || [],
      attachments: attachmentsByVisit.get(visit.id) || [],
      pdfs: pdfsByVisit.get(visit.id) || []
    }));
  }

  private mapVisit(row: {
    id: string;
    patientId: string;
    courseId: string;
    visitDate: string;
    noteType: VisitNoteRecord["noteType"];
    treatmentNumber: number | null;
    status: VisitNoteRecord["status"];
    therapistName: string;
    vitalsJson: string;
    structuredFieldsJson: string;
    generatedText: string;
    editedText: string;
    pdfPath: string | null;
    pdfAssetId: string | null;
    createdAt: string;
    updatedAt: string;
  }) {
    return {
      id: row.id,
      patientId: row.patientId,
      courseId: row.courseId,
      visitDate: row.visitDate,
      noteType: row.noteType,
      treatmentNumber: row.treatmentNumber,
      status: row.status,
      therapistName: row.therapistName,
      vitals: JSON.parse(row.vitalsJson || "{}"),
      structuredFields: JSON.parse(row.structuredFieldsJson || "{}"),
      generatedText: row.generatedText,
      editedText: row.editedText,
      pdfAsset: this.toAssetReference(row.pdfPath, "generated_pdf"),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    } satisfies VisitNoteRecord;
  }

  private placeholders(count: number) {
    return new Array(count).fill("?").join(", ");
  }

  private insertDocumentOnlySite(recordId: string, site: DocumentOnlySiteInput, timestamp: string) {
    this.run(
      `INSERT INTO document_only_sites (
         id, record_id, site_number, body_location, treatment_location_text, diagnosis_text, biopsy_date, icd10,
         number_of_blocks, lesion_size, treatment_depth, cone_size, cutout_size, shields, machine, energy_kv, treatment_interval,
         additional_devices, worksheet_side, worksheet_positioning, worksheet_vac_lok_area, worksheet_eye_shield_type,
         worksheet_gum_shield_position, worksheet_lip_shield_position, daily_dose, total_dose, projected_fractions, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        site.id ?? makeId("document-only-site"),
        recordId,
        site.siteNumber,
        site.bodyLocation,
        site.treatmentLocationText,
        site.diagnosisText,
        site.biopsyDate ?? "",
        site.icd10,
        site.numberOfBlocks,
        site.lesionSize,
        site.treatmentDepth,
        site.coneSize,
        site.cutoutSize,
        site.shields,
        site.machine,
        site.energyKv,
        site.treatmentInterval,
        site.additionalDevices,
        site.worksheetSide ?? "",
        site.worksheetPositioning ?? "",
        site.worksheetVacLokArea ?? "",
        site.worksheetEyeShieldType ?? "",
        site.worksheetGumShieldPosition ?? "",
        site.worksheetLipShieldPosition ?? "",
        site.dailyDose,
        site.totalDose,
        site.projectedFractions ?? null,
        timestamp,
        timestamp
      ]
    );
  }

  private insertSite(courseId: string, site: TreatmentSiteInput, timestamp: string) {
    this.run(
      `INSERT INTO treatment_sites (
         id, course_id, site_number, body_location, treatment_location_text, diagnosis_text, biopsy_date, icd10,
         number_of_blocks, lesion_size, treatment_depth, cone_size, cutout_size, shields, machine, energy_kv, treatment_interval,
         additional_devices, worksheet_side, worksheet_positioning, worksheet_vac_lok_area, worksheet_eye_shield_type,
         worksheet_gum_shield_position, worksheet_lip_shield_position, daily_dose, total_dose, prescribed_fractions, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
        site.id ?? makeId("site"),
        courseId,
        site.siteNumber,
        site.bodyLocation,
        site.treatmentLocationText,
        site.diagnosisText,
        site.biopsyDate ?? "",
        site.icd10,
        site.numberOfBlocks,
        site.lesionSize,
        site.treatmentDepth,
        site.coneSize,
        site.cutoutSize,
        site.shields,
        site.machine,
        site.energyKv,
        site.treatmentInterval,
        site.additionalDevices,
        site.worksheetSide ?? "",
        site.worksheetPositioning ?? "",
          site.worksheetVacLokArea ?? "",
          site.worksheetEyeShieldType ?? "",
          site.worksheetGumShieldPosition ?? "",
          site.worksheetLipShieldPosition ?? "",
          site.dailyDose,
          site.totalDose,
          site.prescribedFractions ?? null,
          timestamp,
        timestamp
      ]
    );
  }

  private createSchema() {
    this.db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY,
        app_name TEXT NOT NULL,
        pin_hash TEXT,
        pin_salt TEXT,
        recovery_code_hash TEXT,
        recovery_code_salt TEXT,
        default_therapist TEXT NOT NULL DEFAULT '',
        supervising_physician TEXT NOT NULL DEFAULT '',
         dermatology_office_name TEXT NOT NULL DEFAULT '',
         dermatology_office_logo_path TEXT,
         dermatology_office_logo_asset_id TEXT,
         inactivity_timeout_minutes INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_options (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        mrn TEXT NOT NULL,
        dob TEXT NOT NULL,
        sex TEXT NOT NULL DEFAULT '',
        face_photo_path TEXT,
        face_photo_asset_id TEXT,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS document_only_records (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        mrn TEXT NOT NULL,
        dob TEXT NOT NULL,
        sex TEXT NOT NULL DEFAULT '',
        therapist_name TEXT NOT NULL DEFAULT '',
        course_type TEXT NOT NULL,
        biopsy_date TEXT NOT NULL,
        sim_consult_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_only_sites (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        site_number INTEGER NOT NULL,
        body_location TEXT NOT NULL,
        treatment_location_text TEXT NOT NULL,
        diagnosis_text TEXT NOT NULL,
        biopsy_date TEXT NOT NULL DEFAULT '',
        icd10 TEXT NOT NULL,
        number_of_blocks INTEGER NOT NULL DEFAULT 1,
        lesion_size TEXT NOT NULL DEFAULT '',
        treatment_depth TEXT NOT NULL,
        cone_size TEXT NOT NULL,
        cutout_size TEXT NOT NULL,
        shields TEXT NOT NULL,
        machine TEXT NOT NULL,
        energy_kv TEXT NOT NULL,
        treatment_interval TEXT NOT NULL,
        additional_devices TEXT NOT NULL,
        worksheet_side TEXT NOT NULL DEFAULT '',
        worksheet_positioning TEXT NOT NULL DEFAULT '',
        worksheet_vac_lok_area TEXT NOT NULL DEFAULT '',
        worksheet_eye_shield_type TEXT NOT NULL DEFAULT '',
        worksheet_gum_shield_position TEXT NOT NULL DEFAULT '',
        worksheet_lip_shield_position TEXT NOT NULL DEFAULT '',
        daily_dose INTEGER NOT NULL,
        total_dose INTEGER NOT NULL,
        projected_fractions INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES document_only_records(id)
      );

      CREATE TABLE IF NOT EXISTS document_only_files (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_asset_id TEXT,
        caption TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES document_only_records(id)
      );

        CREATE TABLE IF NOT EXISTS treatment_courses (
          id TEXT PRIMARY KEY,
          patient_id TEXT NOT NULL,
          course_name TEXT NOT NULL,
          course_type TEXT NOT NULL,
          prescribed_fractions INTEGER NOT NULL,
          status TEXT NOT NULL,
          start_date TEXT NOT NULL,
          sim_consult_date TEXT,
          end_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY(patient_id) REFERENCES patients(id)
      );

      CREATE TABLE IF NOT EXISTS treatment_sites (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        site_number INTEGER NOT NULL,
        body_location TEXT NOT NULL,
        treatment_location_text TEXT NOT NULL,
        diagnosis_text TEXT NOT NULL,
        biopsy_date TEXT NOT NULL DEFAULT '',
        icd10 TEXT NOT NULL,
        number_of_blocks INTEGER NOT NULL DEFAULT 1,
        lesion_size TEXT NOT NULL DEFAULT '',
        treatment_depth TEXT NOT NULL,
        cone_size TEXT NOT NULL,
        cutout_size TEXT NOT NULL,
        shields TEXT NOT NULL,
        machine TEXT NOT NULL,
        energy_kv TEXT NOT NULL,
        treatment_interval TEXT NOT NULL,
        additional_devices TEXT NOT NULL,
        worksheet_side TEXT NOT NULL DEFAULT '',
        worksheet_positioning TEXT NOT NULL DEFAULT '',
         worksheet_vac_lok_area TEXT NOT NULL DEFAULT '',
         worksheet_eye_shield_type TEXT NOT NULL DEFAULT '',
         worksheet_gum_shield_position TEXT NOT NULL DEFAULT '',
         worksheet_lip_shield_position TEXT NOT NULL DEFAULT '',
         daily_dose INTEGER NOT NULL,
         total_dose INTEGER NOT NULL,
         created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(course_id) REFERENCES treatment_courses(id)
      );

      CREATE TABLE IF NOT EXISTS visit_notes (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        course_id TEXT NOT NULL,
        visit_date TEXT NOT NULL,
        note_type TEXT NOT NULL,
        treatment_number INTEGER,
        status TEXT NOT NULL,
        therapist_name TEXT NOT NULL,
        vitals_json TEXT NOT NULL,
        structured_fields_json TEXT NOT NULL,
        generated_text TEXT NOT NULL,
        edited_text TEXT NOT NULL,
        pdf_path TEXT,
        pdf_asset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(patient_id) REFERENCES patients(id),
        FOREIGN KEY(course_id) REFERENCES treatment_courses(id)
      );

      CREATE TABLE IF NOT EXISTS visit_photos (
        id TEXT PRIMARY KEY,
        visit_note_id TEXT NOT NULL,
        image_path TEXT NOT NULL,
        image_asset_id TEXT,
        sort_order INTEGER NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(visit_note_id) REFERENCES visit_notes(id)
      );

      CREATE TABLE IF NOT EXISTS visit_attachments (
        id TEXT PRIMARY KEY,
        visit_note_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_asset_id TEXT,
        sort_order INTEGER NOT NULL,
        caption TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(visit_note_id) REFERENCES visit_notes(id)
      );

      CREATE TABLE IF NOT EXISTS generated_pdfs (
        id TEXT PRIMARY KEY,
        visit_note_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_asset_id TEXT,
        version_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(visit_note_id) REFERENCES visit_notes(id)
      );

      CREATE TABLE IF NOT EXISTS course_documents (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_asset_id TEXT,
        caption TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(course_id) REFERENCES treatment_courses(id)
      );

      CREATE TABLE IF NOT EXISTS schedule_settings (
        id INTEGER PRIMARY KEY,
        clinic_start_time TEXT NOT NULL DEFAULT '08:00',
        clinic_end_time TEXT NOT NULL DEFAULT '17:00',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_appointments (
        id TEXT PRIMARY KEY,
        patient_id TEXT,
        course_id TEXT,
        patient_name TEXT NOT NULL,
        patient_first_name TEXT NOT NULL DEFAULT '',
        patient_last_name TEXT NOT NULL DEFAULT '',
        patient_mrn TEXT NOT NULL DEFAULT '',
        patient_dob TEXT NOT NULL DEFAULT '',
        patient_sex TEXT NOT NULL DEFAULT '',
        appointment_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        appointment_type TEXT NOT NULL,
        appointment_number INTEGER,
        total_appointments INTEGER,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        series_id TEXT,
        intake_course_type TEXT,
        intake_biopsy_date TEXT NOT NULL DEFAULT '',
        intake_sites_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(patient_id) REFERENCES patients(id),
        FOREIGN KEY(course_id) REFERENCES treatment_courses(id)
      );

      CREATE TABLE IF NOT EXISTS schedule_blocks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        block_date TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        block_type TEXT NOT NULL,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        recurring_weekdays_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS template_definitions (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        course_type TEXT NOT NULL,
        note_type TEXT NOT NULL,
        template_text TEXT NOT NULL,
        default_template_text TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private seedDefaults() {
    const settingsCount = this.scalar<number>("SELECT COUNT(*) AS count FROM app_settings") ?? 0;
    if (!settingsCount) {
      const timestamp = nowIso();
      this.run(
        `INSERT INTO app_settings (
           id,
           app_name,
           pin_hash,
           pin_salt,
           recovery_code_hash,
           recovery_code_salt,
           default_therapist,
           supervising_physician,
           dermatology_office_name,
           dermatology_office_logo_path,
           inactivity_timeout_minutes,
           created_at,
           updated_at
         )
         VALUES (1, ?, NULL, NULL, NULL, NULL, '', '', '', NULL, 5, ?, ?)`,
        [DEFAULT_APP_NAME, timestamp, timestamp]
      );
    } else {
      this.run(
        `UPDATE app_settings
         SET app_name = ?, updated_at = ?
         WHERE id = 1 AND app_name != ?`,
        [DEFAULT_APP_NAME, nowIso(), DEFAULT_APP_NAME]
      );
    }

    // Migration: add lesion_size column if missing
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN lesion_size TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN biopsy_date TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE document_only_sites ADD COLUMN biopsy_date TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }

    // Migration: add number_of_blocks column if missing
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN number_of_blocks INTEGER NOT NULL DEFAULT 1`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_side TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_positioning TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_vac_lok_area TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_eye_shield_type TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_gum_shield_position TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN worksheet_lip_shield_position TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }

    // Migration: add supervising_physician column if missing
    try { this.run(`ALTER TABLE app_settings ADD COLUMN supervising_physician TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE app_settings ADD COLUMN recovery_code_hash TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE app_settings ADD COLUMN recovery_code_salt TEXT`); } catch { /* already exists */ }

    // Migration: add dermatology_office_name column if missing
    try { this.run(`ALTER TABLE app_settings ADD COLUMN dermatology_office_name TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE app_settings ADD COLUMN dermatology_office_logo_path TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE app_settings ADD COLUMN dermatology_office_logo_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE patients ADD COLUMN sex TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE patients ADD COLUMN face_photo_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE visit_notes ADD COLUMN pdf_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE visit_photos ADD COLUMN image_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE visit_attachments ADD COLUMN file_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE generated_pdfs ADD COLUMN file_asset_id TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_sites ADD COLUMN prescribed_fractions INTEGER`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE treatment_courses ADD COLUMN sim_consult_date TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN patient_first_name TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN patient_last_name TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN patient_mrn TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN patient_dob TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN patient_sex TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN intake_course_type TEXT`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN intake_biopsy_date TEXT NOT NULL DEFAULT ''`); } catch { /* already exists */ }
    try { this.run(`ALTER TABLE schedule_appointments ADD COLUMN intake_sites_json TEXT NOT NULL DEFAULT '[]'`); } catch { /* already exists */ }

    this.backfillMissingAssetIds();

    const templateCount = this.scalar<number>("SELECT COUNT(*) AS count FROM template_definitions") ?? 0;
    if (!templateCount) {
      const timestamp = nowIso();
      for (const template of DEFAULT_TEMPLATE_DEFINITIONS) {
        this.run(
          `INSERT INTO template_definitions (
            id, key, course_type, note_type, template_text, default_template_text, active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            template.id,
            template.key,
            template.courseType,
            template.noteType,
            template.templateText,
            template.defaultTemplateText,
            timestamp,
            timestamp
          ]
        );
      }
    } else {
      for (const template of DEFAULT_TEMPLATE_DEFINITIONS) {
        this.run(
          `UPDATE template_definitions
           SET template_text = CASE WHEN template_text = default_template_text THEN ? ELSE template_text END,
               default_template_text = ?,
               updated_at = ?
           WHERE id = ?`,
          [template.defaultTemplateText, template.defaultTemplateText, nowIso(), template.id]
        );
      }

      // Migration: remove standalone "Ultrasound Performed:" label from consult_sim templates
      // so the checkbox token carries the label when checked, nothing when unchecked.
      const oldLabel = "Ultrasound Performed:\n{{structured.ultrasoundPerformed}}";
      const newLabel = "{{structured.ultrasoundPerformed}}";
      const oldPostCareBlock = "Post Care:\n{{structured.postCare}}";
      const oldPostCareBlockCrLf = "Post Care:\r\n{{structured.postCare}}";
      const newPostCareBlock = "Post Care: {{structured.postCare}}";
      const oldFollowUpBlock = "Follow Up:\n{{structured.followUp}}";
      const oldFollowUpBlockCrLf = "Follow Up:\r\n{{structured.followUp}}";
      const newFollowUpBlock = "Follow Up: {{structured.followUp}}";
      const oldTwoSiteTreatmentHpiLine =
        "1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}} and {{site2.diagnosisText}} on the {{site2.bodyLocation}}.";
      const newTwoSiteTreatmentHpiLines =
        "1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.\n2. is following up for {{site2.diagnosisText}} on the {{site2.bodyLocation}}.";
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(
               REPLACE(
                 REPLACE(
                   REPLACE(template_text, 'Cutout flex shield size: {{site1.flexShieldCutoutText}}', 'Cutout flex shield size: {{site1.cutoutSizeDisplay}}'),
                   'Cutout flex shield size: {{site2.flexShieldCutoutText}}',
                   'Cutout flex shield size: {{site2.cutoutSizeDisplay}}'
                 ),
                 'Flex Shield Cutout: {{site1.flexShieldCutoutText}}',
                 'Flex Shield Cutout: {{site1.cutoutSizeDisplay}}'
               ),
               'Flex Shield Cutout: {{site2.flexShieldCutoutText}}',
               'Flex Shield Cutout: {{site2.cutoutSizeDisplay}}'
             ),
             default_template_text = REPLACE(
               REPLACE(
                 REPLACE(
                   REPLACE(default_template_text, 'Cutout flex shield size: {{site1.flexShieldCutoutText}}', 'Cutout flex shield size: {{site1.cutoutSizeDisplay}}'),
                   'Cutout flex shield size: {{site2.flexShieldCutoutText}}',
                   'Cutout flex shield size: {{site2.cutoutSizeDisplay}}'
                 ),
                 'Flex Shield Cutout: {{site1.flexShieldCutoutText}}',
                 'Flex Shield Cutout: {{site1.cutoutSizeDisplay}}'
               ),
               'Flex Shield Cutout: {{site2.flexShieldCutoutText}}',
               'Flex Shield Cutout: {{site2.cutoutSizeDisplay}}'
             ),
             updated_at = ?
         WHERE note_type IN ('consult_sim', 'first_fraction')
           AND (
             template_text LIKE '%Cutout flex shield size: {{site1.flexShieldCutoutText}}%'
             OR template_text LIKE '%Cutout flex shield size: {{site2.flexShieldCutoutText}}%'
             OR default_template_text LIKE '%Cutout flex shield size: {{site1.flexShieldCutoutText}}%'
             OR default_template_text LIKE '%Cutout flex shield size: {{site2.flexShieldCutoutText}}%'
             OR template_text LIKE '%Flex Shield Cutout: {{site1.flexShieldCutoutText}}%'
             OR template_text LIKE '%Flex Shield Cutout: {{site2.flexShieldCutoutText}}%'
             OR default_template_text LIKE '%Flex Shield Cutout: {{site1.flexShieldCutoutText}}%'
             OR default_template_text LIKE '%Flex Shield Cutout: {{site2.flexShieldCutoutText}}%'
           )`,
        [nowIso()]
      );
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(REPLACE(REPLACE(REPLACE(template_text, ?, ?), ?, ?), ?, ?), ?, ?),
             default_template_text = REPLACE(REPLACE(REPLACE(REPLACE(default_template_text, ?, ?), ?, ?), ?, ?), ?, ?),
             updated_at = ?
         WHERE note_type != 'consult_sim'
           AND (
             template_text LIKE '%Post Care:%{{structured.postCare}}%'
             OR template_text LIKE '%Follow Up:%{{structured.followUp}}%'
             OR default_template_text LIKE '%Post Care:%{{structured.postCare}}%'
             OR default_template_text LIKE '%Follow Up:%{{structured.followUp}}%'
           )`,
        [
          oldPostCareBlockCrLf,
          newPostCareBlock,
          oldPostCareBlock,
          newPostCareBlock,
          oldFollowUpBlockCrLf,
          newFollowUpBlock,
          oldFollowUpBlock,
          newFollowUpBlock,
          oldPostCareBlockCrLf,
          newPostCareBlock,
          oldPostCareBlock,
          newPostCareBlock,
          oldFollowUpBlockCrLf,
          newFollowUpBlock,
          oldFollowUpBlock,
          newFollowUpBlock,
          nowIso()
        ]
      );
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(template_text, ?, ?),
             default_template_text = REPLACE(default_template_text, ?, ?),
             updated_at = ?
         WHERE course_type = 'two_site'
           AND note_type != 'consult_sim'
           AND (
             template_text LIKE ?
             OR default_template_text LIKE ?
           )`,
        [
          oldTwoSiteTreatmentHpiLine,
          newTwoSiteTreatmentHpiLines,
          oldTwoSiteTreatmentHpiLine,
          newTwoSiteTreatmentHpiLines,
          nowIso(),
          `%${oldTwoSiteTreatmentHpiLine}%`,
          `%${oldTwoSiteTreatmentHpiLine}%`
        ]
      );
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(template_text, ?, ?),
             default_template_text = REPLACE(default_template_text, ?, ?),
             updated_at = ?
         WHERE note_type = 'consult_sim'
           AND (template_text LIKE '%Ultrasound Performed:%' OR default_template_text LIKE '%Ultrasound Performed:%')`,
        [oldLabel, newLabel, oldLabel, newLabel, nowIso()]
      );

      // Migration: "Treatment Supervised By:" → "Treatment Supervised By Dermatologist:"
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(REPLACE(template_text, 'Treatment Supervised By Dermatologist:', 'Treatment Supervised by:'), 'Treatment Supervised By:', 'Treatment Supervised by:'),
             default_template_text = REPLACE(REPLACE(default_template_text, 'Treatment Supervised By Dermatologist:', 'Treatment Supervised by:'), 'Treatment Supervised By:', 'Treatment Supervised by:'),
             updated_at = ?
         WHERE template_text LIKE '%Treatment Supervised By:%'
            OR default_template_text LIKE '%Treatment Supervised By:%'
            OR template_text LIKE '%Treatment Supervised By Dermatologist:%'
            OR default_template_text LIKE '%Treatment Supervised By Dermatologist:%'`,
        [nowIso()]
      );

      // Migration: "Treatments Supervised By:" → "Treatments Supervised By Dermatologist:" (two_site)
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(template_text, 'Treatments Supervised By:', 'Treatment Supervised by:'),
             default_template_text = REPLACE(default_template_text, 'Treatments Supervised By:', 'Treatment Supervised by:'),
             updated_at = ?
         WHERE template_text LIKE '%Treatments Supervised By:%'
            OR default_template_text LIKE '%Treatments Supervised By:%'`,
        [nowIso()]
      );

      // Migration: "Supervised By:" → "Supervised By Dermatologist:" (two_site consult_sim)
      this.run(
        `UPDATE template_definitions
         SET template_text = REPLACE(REPLACE(template_text, 'Supervised By Dermatologist:', 'Supervised by:'), 'Supervised By:', 'Supervised by:'),
             default_template_text = REPLACE(REPLACE(default_template_text, 'Supervised By Dermatologist:', 'Supervised by:'), 'Supervised By:', 'Supervised by:'),
             updated_at = ?
         WHERE note_type = 'consult_sim'
           AND (
             template_text LIKE '%Supervised By:%'
             OR default_template_text LIKE '%Supervised By:%'
             OR template_text LIKE '%Supervised By Dermatologist:%'
             OR default_template_text LIKE '%Supervised By Dermatologist:%'
           )`,
        [nowIso()]
      );

      // Migration: sync all templates to latest defaults.
      // If template_text was never customized (equals default_template_text), reset it to the new default too.
      // Always update default_template_text to the latest version.
      const ts = nowIso();
      for (const tmpl of DEFAULT_TEMPLATE_DEFINITIONS) {
        this.run(
          `UPDATE template_definitions
           SET template_text = CASE WHEN template_text = default_template_text THEN ? ELSE template_text END,
               default_template_text = ?,
               updated_at = ?
           WHERE key = ?`,
          [tmpl.templateText, tmpl.defaultTemplateText, ts, tmpl.key]
        );
      }
    }
  }

  private resolveNextAssetId(previousPath: string | null, previousAssetId: string | null, nextPath: string | null) {
    if (!nextPath) {
      return null;
    }

    if (previousAssetId && previousPath === nextPath) {
      return previousAssetId;
    }

    return makeAssetId();
  }

  private backfillMissingAssetIds() {
    this.mutate(() => {
      this.run(
        `UPDATE app_settings
         SET dermatology_office_logo_asset_id = ?
         WHERE id = 1
           AND dermatology_office_logo_path IS NOT NULL
           AND (dermatology_office_logo_asset_id IS NULL OR dermatology_office_logo_asset_id = '')`,
        [makeAssetId()]
      );

      this.queryAll<{ id: string }>(
        `SELECT id FROM patients WHERE face_photo_path IS NOT NULL AND (face_photo_asset_id IS NULL OR face_photo_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE patients SET face_photo_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string }>(
        `SELECT id FROM visit_photos WHERE image_path IS NOT NULL AND (image_asset_id IS NULL OR image_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE visit_photos SET image_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string }>(
        `SELECT id FROM visit_attachments WHERE file_path IS NOT NULL AND (file_asset_id IS NULL OR file_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE visit_attachments SET file_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string }>(
        `SELECT id FROM generated_pdfs WHERE file_path IS NOT NULL AND (file_asset_id IS NULL OR file_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE generated_pdfs SET file_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string }>(
        `SELECT id FROM course_documents WHERE file_path IS NOT NULL AND (file_asset_id IS NULL OR file_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE course_documents SET file_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string }>(
        `SELECT id FROM document_only_files WHERE file_path IS NOT NULL AND (file_asset_id IS NULL OR file_asset_id = '')`
      ).forEach((row) => {
        this.run(`UPDATE document_only_files SET file_asset_id = ? WHERE id = ?`, [makeAssetId(), row.id]);
      });

      this.queryAll<{ id: string; pdfPath: string }>(
        `SELECT id, pdf_path AS pdfPath
         FROM visit_notes
         WHERE pdf_path IS NOT NULL
           AND (pdf_asset_id IS NULL OR pdf_asset_id = '')`
      ).forEach((row) => {
        const existingPdfAsset = this.queryOne<{ fileAssetId: string | null }>(
          `SELECT file_asset_id AS fileAssetId
           FROM generated_pdfs
           WHERE file_path = ?
             AND file_asset_id IS NOT NULL
             AND file_asset_id != ''
           ORDER BY version_number DESC
           LIMIT 1`,
          [row.pdfPath]
        );
        this.run(`UPDATE visit_notes SET pdf_asset_id = ? WHERE id = ?`, [existingPdfAsset?.fileAssetId ?? makeAssetId(), row.id]);
      });
    });
  }

  private rebuildAssetReferenceIndex() {
    const registry = this.assetStore as AssetStoreRegistry;
    if (!registry.registerStoredAssetReference) {
      return;
    }

    const register = (assetId: string | null, filePath: string | null, kind: AssetReference["kind"]) => {
      if (!assetId || !filePath) {
        return;
      }

      registry.registerStoredAssetReference!({ assetId, kind }, filePath);
    };

    const settingsAsset = this.queryOne<{ assetId: string | null; filePath: string | null }>(
      `SELECT dermatology_office_logo_asset_id AS assetId, dermatology_office_logo_path AS filePath FROM app_settings WHERE id = 1`
    );
    register(settingsAsset?.assetId ?? null, settingsAsset?.filePath ?? null, "settings_logo");

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT face_photo_asset_id AS assetId, face_photo_path AS filePath FROM patients WHERE face_photo_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "patient_face_photo"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT pdf_asset_id AS assetId, pdf_path AS filePath FROM visit_notes WHERE pdf_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "generated_pdf"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT image_asset_id AS assetId, image_path AS filePath FROM visit_photos WHERE image_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "visit_photo"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT file_asset_id AS assetId, file_path AS filePath FROM visit_attachments WHERE file_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "visit_attachment"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT file_asset_id AS assetId, file_path AS filePath FROM generated_pdfs WHERE file_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "generated_pdf"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT file_asset_id AS assetId, file_path AS filePath FROM course_documents WHERE file_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "course_document"));

    this.queryAll<{ assetId: string | null; filePath: string | null }>(
      `SELECT file_asset_id AS assetId, file_path AS filePath FROM document_only_files WHERE file_path IS NOT NULL`
    ).forEach((row) => register(row.assetId, row.filePath, "course_document"));
  }

  private run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }

  private queryAll<T>(sql: string, params: SqlValue[] = []) {
    const statement = this.db.prepare(sql, params);
    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    statement.free();
    return rows;
  }

  private queryOne<T>(sql: string, params: SqlValue[] = []) {
    return this.queryAll<T>(sql, params)[0] ?? null;
  }

  private scalar<T>(sql: string, params: SqlValue[] = []) {
    const row = this.queryOne<Record<string, T>>(sql, params);
    if (!row) {
      return null;
    }

    return Object.values(row)[0] ?? null;
  }

  private mutate<T>(callback: () => T) {
    const result = callback();
    this.persist();
    return result;
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }
}
