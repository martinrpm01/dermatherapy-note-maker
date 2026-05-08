import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  PatientArchiveExportResult,
  PatientArchiveIoHandle,
  PatientArchivePreflightResult,
  PatientArchiveRestoreResult,
  PatientArchiveReadResult,
  PreparedPatientArchiveDescription
} from "../shared/archive";
import { buildVisitPdf } from "./pdf";
import { buildConsentFormPdf, buildSignedConsentFormPdf, buildUploadedConsentPdf } from "./consent-form";
import { buildSimWorksheetPdf } from "./sim-worksheet";
import { PatientArchivePreparationService } from "./archive-preparation";
import { DesktopPatientArchiveExportService } from "./archive-export";
import { DesktopPatientArchiveReaderService } from "./archive-reader";
import { DesktopPatientArchiveRestoreService } from "./archive-restore";
import {
  applyAutomaticDoseValuesToSiteSnapshot,
  applyAutoNumberOfBlocks,
  buildDefaultStructuredFields,
  buildShieldSummary,
  buildSimulationComplicationLine,
  buildSimulationComplicationText,
  calculateAgeAtDate,
  buildSiteSnapshots,
  createEmptyVitals,
  fillMissingSitePrescribedFractions,
  formatAdditionalDevicesForSite,
  formatDisplayDate,
  formatVitals,
  getAutoNumberOfBlocks,
  getCurrentFraction,
  getDefaultFinalTreatmentNote,
  getDefaultMipsNote,
  getDefaultOtvNote,
  getDefaultPhysicsComment,
  getMaxSitePrescribedFractions,
  getNextTreatmentNumber,
  getSuggestedNoteType,
  getTemplateKey,
  isFinalTreatmentEligible,
  normalizeVacLokAreaValue,
  refreshVisitSiteSnapshots,
  normalizeWorksheetDeviceDetailsForSite,
  normalizeVacLokPlacement,
  normalizeCutoutSizeLabel,
  normalizeOptionValue,
  stripExamVitalsSection
} from "../shared/note-rules";
import {
  ensureValidPin,
  generatePinSalt,
  generateRecoveryCode,
  hashPin,
  normalizeRecoveryCode,
  verifyPin
} from "../shared/pin-auth";
import { renderTemplate, validateTemplate } from "../shared/template-engine";
import {
  buildDocumentOnlySyntheticContext
} from "../shared/document-only";
import type {
  AssetReference,
  ArchiveSnapshot,
  BootstrapPayload,
  ConsentSigningInput,
  DocumentOnlyInput,
  DocumentOnlySnapshot,
  CourseInput,
  DashboardSnapshot,
  PatientDetail,
  PatientInput,
  PatientRecord,
  PdfGenerationResult,
  ScheduleAppointmentInput,
  ScheduleAppointmentRecord,
  ScheduleAppointmentStatus,
  ScheduleBlockInput,
  ScheduleSettingsView,
  SavedOptionType,
  SettingsPayload,
  SiteSnapshot,
  StoredAssetUpload,
  TreatmentCourseRecord,
  VisitDraftOptions,
  VisitEditorState,
  VisitInput,
  VisitNoteRecord
} from "../shared/types";
import type { BinaryAssetStore, StructuredDataStore } from "../shared/storage";

type AssetAwareStructuredDataStore = StructuredDataStore & {
  savePatient(input: PatientInput, facePhoto: AssetReference | null): PatientRecord;
  addVisitPhoto(visitId: string, image: AssetReference, sortOrder: number, caption: string): void;
  addVisitAttachment(
    visitId: string,
    file: AssetReference,
    sortOrder: number,
    caption: string,
    mimeType: string,
    originalName: string
  ): void;
  insertGeneratedPdf(visitId: string, file: AssetReference, versionNumber: number): void;
  updateSettings(input: Omit<SettingsPayload["settings"], "dermatologyOfficeLogoUpload" | "removeDermatologyOfficeLogo">): void;
};

type RecoveryCapableStructuredDataStore = StructuredDataStore & {
  updateRecoveryCode(hash: string, salt: string): void;
  updatePinAndRecovery(
    pinHash: string,
    pinSalt: string,
    recoveryCodeHash: string,
    recoveryCodeSalt: string
  ): void;
  wipeAllData(): void;
};

type WipeCapableBinaryAssetStore = BinaryAssetStore & {
  wipeAllData(): void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatMeasurement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalizeOptionValue(normalized) === "none" || normalizeOptionValue(normalized) === "open cone") {
    return "Open Cone";
  }
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

function sanitizeNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function sanitizeFolderName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[. ]+$/g, "");
}

function buildVersionedDocumentPath(basePath: string) {
  const parsed = path.parse(basePath);
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

function getDefaultMachine(value: string) {
  return value.trim() || "Xoft Elekta 1200 SPX";
}

function getDefaultTreatmentDepth(value: string) {
  return value.trim() || "3";
}

function buildAdditionalNotesSection(value: string) {
  const trimmed = value.trim();
  return trimmed ? `Additional Notes:\n${trimmed}\n` : "";
}

function isLockedFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code !== undefined &&
    ["EBUSY", "EPERM"].includes(String((error as { code?: string }).code))
  );
}

function buildFinalTreatmentSection(enabled: boolean, value?: string) {
  if (!enabled) {
    return "";
  }

  return `${value?.trim() || getDefaultFinalTreatmentNote()}\n`;
}

function buildMipsSection(enabled: boolean, value?: string) {
  if (!enabled) {
    return "";
  }

  return `MIPS:\n${value?.trim() || getDefaultMipsNote()}\n`;
}

function injectFinalTreatmentSection(renderedText: string, finalTreatmentSection: string) {
  const trimmedSection = finalTreatmentSection.trim();
  if (!trimmedSection) {
    return renderedText;
  }

  if (renderedText.includes(trimmedSection)) {
    return renderedText;
  }

  if (!renderedText.includes("Follow Up:")) {
    return renderedText;
  }

  return renderedText.replace("Follow Up:", `${trimmedSection}\n\nFollow Up:`);
}

function injectMipsSection(renderedText: string, mipsSection: string) {
  const trimmedSection = mipsSection.trim();
  if (!trimmedSection) {
    return renderedText;
  }

  if (renderedText.includes(trimmedSection)) {
    return renderedText;
  }

  for (const marker of ["Additional Notes:", "Patient successfully completed the prescribed course of radiation therapy.", "Follow Up:", "Treatment Supervised by:"]) {
    if (renderedText.includes(marker)) {
      return renderedText.replace(marker, `${trimmedSection}\n\n${marker}`);
    }
  }

  return `${renderedText}\n\n${trimmedSection}`;
}

function injectPhysicsConsultationDetails(renderedText: string, physicsComment: string, bodyLocations: string[]) {
  const trimmedComment = physicsComment.trim();
  if (!trimmedComment && bodyLocations.every((location) => !location.trim())) {
    return renderedText;
  }

  const commentFirstLine = trimmedComment.split("\n")[0]?.trim() ?? "";
  const lines = renderedText.split("\n");
  let consultationIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("Physics Consultation:")) {
      continue;
    }

    const bodyLocation = bodyLocations[consultationIndex]?.trim() ?? "";
    lines[index] = line.replace(/ for .+$/, "");
    if (bodyLocation) {
      const locationLine = `Location: ${bodyLocation}`;
      const previousLine = (lines[index - 1] ?? "").trim();
      if (previousLine.startsWith("Location:")) {
        lines[index - 1] = locationLine;
      } else {
        lines.splice(index, 0, locationLine);
        index += 1;
      }
    }

    if (trimmedComment && commentFirstLine) {
      const nextLine = (lines[index + 1] ?? "").trim();
      if (nextLine !== commentFirstLine) {
        lines.splice(index + 1, 0, trimmedComment);
        index += trimmedComment.split("\n").length;
      }
    }

    consultationIndex += 1;
  }

  return lines.join("\n");
}

function buildFlexShieldCutoutText(cutoutSize: string, coneSize: string) {
  const cutoutDisplay = formatMeasurement(cutoutSize);
  const coneDisplay = formatMeasurement(coneSize);
  const openCone = normalizeOptionValue(cutoutSize) === "open cone" || normalizeOptionValue(cutoutSize) === "none";

  if (openCone) {
    return coneDisplay ? `Open ${coneDisplay} Cone` : "Open Cone";
  }

  if (cutoutDisplay && coneDisplay) {
    return `${cutoutDisplay}, to be used with a ${coneDisplay} cone`;
  }

  return cutoutDisplay || "";
}

function buildTreatmentLabel(note: VisitInput) {
  if (note.treatmentNumber === null) {
    return "consult";
  }

  return `tx ${note.treatmentNumber}`;
}

function ensureUniqueCourseSiteIds(sites: CourseInput["sites"]) {
  const seen = new Set<string>();
  return sites.map((site) => {
    if (!site.id) {
      return site;
    }
    if (seen.has(site.id)) {
      const { id, ...siteWithoutDuplicateId } = site;
      return siteWithoutDuplicateId;
    }
    seen.add(site.id);
    return site;
  });
}

export class RadiationNoteService {
  private isLocked = true;
  private readonly archivePreparationService: PatientArchivePreparationService;
  private readonly archiveExportService: DesktopPatientArchiveExportService;
  private readonly archiveReaderService: DesktopPatientArchiveReaderService;
  private readonly archiveRestoreService: DesktopPatientArchiveRestoreService;

  constructor(
    private readonly repository: StructuredDataStore,
    private readonly assetStore: BinaryAssetStore,
    private readonly patientNoteLibraryRoot?: string,
    private readonly defaultNoteLogoPath?: string,
    private readonly patientArchiveExportRoot?: string
  ) {
    this.archivePreparationService = new PatientArchivePreparationService(repository, assetStore);
    this.archiveExportService = new DesktopPatientArchiveExportService(
      assetStore,
      patientArchiveExportRoot || path.join(repository.baseDir, "Patient Archives")
    );
    this.archiveReaderService = new DesktopPatientArchiveReaderService();
    this.archiveRestoreService = new DesktopPatientArchiveRestoreService(
      repository,
      assetStore,
      this.archiveReaderService,
      patientNoteLibraryRoot || path.join(repository.baseDir, "All Patient Notes")
    );
  }

  async initialize() {
    await this.repository.initialize();
    this.assetStore.initialize();
    this.isLocked = Boolean(this.repository.getSettingsRecord().pinHash);
  }

  bootstrap(): BootstrapPayload {
    const settings = this.repository.getSettingsRecord();
    return {
      settings: this.repository.toSettingsView(settings),
      requiresPinSetup: !settings.pinHash,
      isLocked: this.isLocked
    };
  }

  async unlock(pin: string) {
    const settings = this.repository.getSettingsRecord();
    if (!settings.pinHash || !settings.pinSalt) {
      return false;
    }

    const matches = await verifyPin(pin, settings.pinSalt, settings.pinHash);
    this.isLocked = !matches;
    return matches;
  }

  lock() {
    this.isLocked = true;
  }

  async setInitialPin(pin: string) {
    ensureValidPin(pin);
    const settings = this.repository.getSettingsRecord();
    if (settings.pinHash) {
      throw new Error("PIN already exists.");
    }

    const pinSalt = generatePinSalt();
    const pinHash = await hashPin(pin, pinSalt);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeSalt = generatePinSalt();
    const recoveryCodeHash = await hashPin(recoveryCode, recoveryCodeSalt);
    this.getRecoveryStructuredStore().updatePinAndRecovery(pinHash, pinSalt, recoveryCodeHash, recoveryCodeSalt);
    this.isLocked = false;
    return recoveryCode;
  }

  async changePin(currentPin: string, nextPin: string) {
    if (!(await this.unlock(currentPin))) {
      throw new Error("Current PIN is incorrect.");
    }

    ensureValidPin(nextPin);
    const salt = generatePinSalt();
    const hash = await hashPin(nextPin, salt);
    this.repository.updatePin(hash, salt);
    this.isLocked = false;
  }

  async resetPinWithRecoveryCode(recoveryCode: string, nextPin: string) {
    ensureValidPin(nextPin);
    const settings = this.repository.getSettingsRecord();
    if (!settings.recoveryCodeHash || !settings.recoveryCodeSalt) {
      throw new Error("Recovery code is incorrect.");
    }

    const matches = await verifyPin(
      normalizeRecoveryCode(recoveryCode),
      settings.recoveryCodeSalt,
      settings.recoveryCodeHash
    );
    if (!matches) {
      throw new Error("Recovery code is incorrect.");
    }

    const pinSalt = generatePinSalt();
    const pinHash = await hashPin(nextPin, pinSalt);
    const nextRecoveryCode = generateRecoveryCode();
    const recoveryCodeSalt = generatePinSalt();
    const recoveryCodeHash = await hashPin(nextRecoveryCode, recoveryCodeSalt);
    this.getRecoveryStructuredStore().updatePinAndRecovery(pinHash, pinSalt, recoveryCodeHash, recoveryCodeSalt);
    this.isLocked = false;
    return nextRecoveryCode;
  }

  async wipeAllLocalData() {
    // This is an irreversible last-resort reset path used only after the renderer
    // has required an explicit confirmation phrase from the user.
    this.getWipeableAssetStore().wipeAllData();
    this.getRecoveryStructuredStore().wipeAllData();

    const patientNoteLibraryRoot = this.patientNoteLibraryRoot || path.join(this.repository.baseDir, "All Patient Notes");
    if (fs.existsSync(patientNoteLibraryRoot)) {
      fs.rmSync(patientNoteLibraryRoot, { recursive: true, force: true });
    }

    this.isLocked = false;
  }

  getDashboardSnapshot(): DashboardSnapshot {
    this.assertUnlocked();

    const activePatients = this.repository.fetchPatients("status = ?", ["active"]);
    const activeCourses = this.repository.fetchCourses("status = ?", ["active"]);
    const pendingCourses = this.repository.fetchCourses("status = ?", ["pending"]);
    const courseIds = activeCourses.map((course) => course.id);
    const courseSites = this.repository.fetchSites(courseIds);
    const visits = this.repository.fetchVisitsByCourseIds(courseIds);
    const patientMap = new Map(activePatients.map((patient) => [patient.id, patient]));
    const siteMap = new Map<string, typeof courseSites>();
    const visitMap = new Map<string, typeof visits>();

    for (const site of courseSites) {
      const list = siteMap.get(site.courseId) || [];
      list.push(site);
      siteMap.set(site.courseId, list);
    }

    for (const visit of visits) {
      const list = visitMap.get(visit.note.courseId) || [];
      list.push(visit);
      visitMap.set(visit.note.courseId, list);
    }

    const patientIdsWithActiveCourse = new Set(activeCourses.map((c) => c.patientId));
    // Only show patients with zero courses ever — patients with completed courses belong in the Completed tab
    const allCourses = this.repository.fetchCourses("1 = 1", []);
    const patientIdsWithAnyCourse = new Set(allCourses.map((c) => c.patientId));
    const patientsWithoutCourse = activePatients
      .filter((p) => !patientIdsWithActiveCourse.has(p.id) && !patientIdsWithAnyCourse.has(p.id))
      .map((p) => ({
        patientId: p.id,
        patientName: `${p.lastName}, ${p.firstName}`,
        patientMrn: p.mrn,
        patientDob: p.dob,
        patientFacePhoto: p.facePhoto
      }));

    return {
      activeCourses: activeCourses
        .map((course) => {
          const patient = patientMap.get(course.patientId);
          if (!patient) {
            return null;
          }

          const visitsForCourse = visitMap.get(course.id) || [];
          const sitesForCourse = siteMap.get(course.id) || [];
          const hasConsultVisit = visitsForCourse.some((visit) => visit.note.noteType === "consult_sim");
          const latestDraftVisit = visitsForCourse
            .filter((visit) => !visit.note.pdfAsset)
            .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
          const currentFraction = getCurrentFraction(visitsForCourse);
          const hasPlannedConsult = Boolean(course.simConsultDate);
          const shouldStartWithConsult =
            !hasConsultVisit && currentFraction === 0 && (hasPlannedConsult || course.prescribedFractions <= 0);
          const suggestedTreatmentNumber = shouldStartWithConsult ? null : getNextTreatmentNumber(visitsForCourse);
          const suggestedNoteType = shouldStartWithConsult ? "consult_sim" : getSuggestedNoteType(suggestedTreatmentNumber);

          return {
            patientId: patient.id,
            patientName: `${patient.lastName}, ${patient.firstName}`,
            patientMrn: patient.mrn,
            patientDob: patient.dob,
            patientFacePhoto: patient.facePhoto,
            courseId: course.id,
            courseName: course.courseName,
            courseType: course.courseType,
            prescribedFractions: course.prescribedFractions,
            currentFraction,
            suggestedTreatmentNumber,
            suggestedNoteType,
            nextTemplateKey: getTemplateKey(course.courseType, suggestedNoteType),
            siteSummary: sitesForCourse.map((site) => site.bodyLocation).join(" + "),
            latestDraftVisitId: latestDraftVisit?.note.id ?? null,
            latestDraftUpdatedAt: latestDraftVisit?.note.updatedAt ?? null
          };
        })
        .filter(Boolean) as DashboardSnapshot["activeCourses"],
      pendingCourses: pendingCourses
        .map((course) => {
          const patient = patientMap.get(course.patientId);
          if (!patient) {
            return null;
          }

          const sitesForCourse = this.repository.fetchSites([course.id]);
          const documentsForCourse = this.repository.fetchCourseDocuments(course.id);
          return {
            patientId: patient.id,
            patientName: `${patient.lastName}, ${patient.firstName}`,
            patientMrn: patient.mrn,
            patientDob: patient.dob,
            patientFacePhoto: patient.facePhoto,
            courseId: course.id,
            courseName: course.courseName,
            courseType: course.courseType,
            prescribedFractions: course.prescribedFractions,
            siteSummary: sitesForCourse.map((site) => site.bodyLocation).join(" + "),
            hasConsentForm: documentsForCourse.some((document) => document.documentType === "consent_form")
          };
        })
        .filter(Boolean) as DashboardSnapshot["pendingCourses"],
      patientsWithoutCourse,
      archivedPatients: this.repository.countPatients("status != 'active'"),
      archivedCourses: this.repository.countCourses("status != 'active'")
    };
  }

  getScheduleSnapshot(startDate: string, endDate: string) {
    this.assertUnlocked();
    const dashboard = this.getDashboardSnapshot();
    const pendingCourses = dashboard.pendingCourses.map((course) => ({
      ...course,
      currentFraction: 0,
      suggestedTreatmentNumber: 1,
      suggestedNoteType: "standard_treatment" as const,
      nextTemplateKey: getTemplateKey(course.courseType, "standard_treatment"),
      latestDraftVisitId: null,
      latestDraftUpdatedAt: null
    }));
    return {
      appointments: this.repository.fetchScheduleAppointments(startDate, endDate),
      blocks: this.repository.fetchScheduleBlocks(startDate, endDate),
      settings: this.repository.getScheduleSettings(),
      activeCourses: [...pendingCourses, ...dashboard.activeCourses]
    };
  }

  saveScheduleAppointment(input: ScheduleAppointmentInput) {
    this.assertUnlocked();
    const saved = this.repository.saveScheduleAppointment(input);
    if (saved.courseId) {
      this.repository.syncCourseScheduleDates(saved.courseId);
    }
    return this.repository.fetchScheduleAppointment(saved.id) ?? saved;
  }

  deleteScheduleAppointment(appointmentId: string) {
    this.assertUnlocked();
    const existing = this.repository.fetchScheduleAppointment(appointmentId);
    this.repository.deleteScheduleAppointment(appointmentId);
    if (existing?.courseId) {
      this.repository.syncCourseScheduleDates(existing.courseId);
    }
  }

  deleteCourseTreatmentSchedule(courseId: string) {
    this.assertUnlocked();
    return this.repository.deleteCourseTreatmentSchedule(courseId);
  }

  updateScheduleAppointmentStatus(appointmentId: string, status: ScheduleAppointmentStatus) {
    this.assertUnlocked();
    const saved = this.repository.updateScheduleAppointmentStatus(appointmentId, status);
    if (saved.courseId) {
      this.repository.syncCourseScheduleDates(saved.courseId);
    }
    return this.repository.fetchScheduleAppointment(saved.id) ?? saved;
  }

  saveScheduleBlock(input: ScheduleBlockInput) {
    this.assertUnlocked();
    return this.repository.saveScheduleBlock(input);
  }

  deleteScheduleBlock(blockId: string) {
    this.assertUnlocked();
    this.repository.deleteScheduleBlock(blockId);
  }

  saveScheduleSettings(input: ScheduleSettingsView) {
    this.assertUnlocked();
    return this.repository.saveScheduleSettings(input);
  }

  completeScheduleAppointmentForVisit(visitId: string): ScheduleAppointmentRecord | null {
    this.assertUnlocked();
    const visit = this.repository.fetchVisit(visitId);
    if (!visit || visit.status !== "finalized") {
      return null;
    }

    const matchingAppointments = this.repository
      .fetchScheduleAppointments("1900-01-01", "2999-12-31")
      .filter((appointment) => appointment.status !== "completed")
      .filter((appointment) => {
        if (appointment.courseId && appointment.courseId !== visit.courseId) {
          return false;
        }
        if (appointment.patientId && appointment.patientId !== visit.patientId) {
          return false;
        }
        if (visit.noteType === "consult_sim") {
          return appointment.appointmentType === "sim_consult";
        }
        if (appointment.appointmentType !== "treatment") {
          return false;
        }
        if (visit.treatmentNumber !== null) {
          return appointment.appointmentNumber === visit.treatmentNumber;
        }
        return appointment.appointmentNumber === null && appointment.appointmentDate === visit.visitDate;
      })
      .sort((left, right) => {
        const leftDateRank = left.appointmentDate === visit.visitDate ? 0 : 1;
        const rightDateRank = right.appointmentDate === visit.visitDate ? 0 : 1;
        if (leftDateRank !== rightDateRank) {
          return leftDateRank - rightDateRank;
        }
        return `${left.appointmentDate}|${left.startTime}`.localeCompare(`${right.appointmentDate}|${right.startTime}`);
      });

    const target = matchingAppointments[0];
    return target ? this.repository.updateScheduleAppointmentStatus(target.id, "completed") : null;
  }

  getDocumentOnlySnapshot(): DocumentOnlySnapshot {
    this.assertUnlocked();
    return {
      records: this.repository.loadDocumentOnlyDetails()
    };
  }

  getPatientDetail(patientId: string): PatientDetail {
    this.assertUnlocked();
    const detail = this.repository.loadPatientDetails([patientId])[0];
    if (!detail) {
      throw new Error("Patient not found.");
    }
    return detail as PatientDetail;
  }

  listCompleted(): ArchiveSnapshot {
    this.assertUnlocked();
    return {
      patients: this.repository.loadPatientDetails(this.repository.fetchCompletedPatientIds()) as PatientDetail[]
    };
  }

  listArchive(): ArchiveSnapshot {
    this.assertUnlocked();
    return {
      patients: this.repository.loadPatientDetails(this.repository.fetchArchivePatientIds()) as PatientDetail[]
    };
  }

  savePatient(input: PatientInput) {
    this.assertUnlocked();
    const patientInput = input.id ? input : { ...input, id: makeId("patient") };
    const patientId = patientInput.id!;
    const existing = this.repository.fetchPatient(patientId);
    const facePhotoPath = patientInput.facePhotoUpload
      ? this.assetStore.saveUpload(
          patientInput.facePhotoUpload,
          this.assetStore.getPatientProfileDir(patientId),
          `face-${patientInput.lastName || patientId || "patient"}`
        )
      : this.resolveAssetPath(existing?.facePhoto ?? null);

    return (this.repository as AssetAwareStructuredDataStore).savePatient(
      patientInput,
      this.assetStore.createAssetReference(facePhotoPath, "patient_face_photo")
    );
  }

  saveDocumentOnlyRecord(input: DocumentOnlyInput) {
    this.assertUnlocked();
    const normalizedInput: DocumentOnlyInput = {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      mrn: input.mrn.trim(),
      dob: input.dob,
      sex: input.sex.trim(),
      therapistName: input.therapistName.trim(),
      sites: input.sites.map((site) => {
        const normalizedPlacement = normalizeVacLokPlacement(site.additionalDevices, site.worksheetPositioning);
        const normalizedDetails = normalizeWorksheetDeviceDetailsForSite({
          additionalDevices: normalizedPlacement.additionalDevices,
          worksheetEyeShieldType: site.worksheetEyeShieldType,
          worksheetGumShieldPosition: site.worksheetGumShieldPosition,
          worksheetLipShieldPosition: site.worksheetLipShieldPosition
        });
        return {
          ...site,
          bodyLocation: site.treatmentLocationText.trim() || site.bodyLocation.trim(),
          treatmentLocationText: site.treatmentLocationText.trim() || site.bodyLocation.trim(),
          diagnosisText: site.diagnosisText.trim(),
          icd10: normalizeIcd10(site.icd10),
          numberOfBlocks: getAutoNumberOfBlocks("consult_sim", site.cutoutSize),
          lesionSize: formatMeasurement(site.lesionSize),
          treatmentDepth: getDefaultTreatmentDepth(site.treatmentDepth),
          coneSize: formatMeasurement(site.coneSize),
          cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
          machine: getDefaultMachine(site.machine),
          additionalDevices: normalizedPlacement.additionalDevices,
          worksheetPositioning: normalizedPlacement.worksheetPositioning,
          worksheetVacLokArea: normalizeVacLokAreaValue(site.worksheetVacLokArea),
          worksheetEyeShieldType: normalizedDetails.worksheetEyeShieldType,
          worksheetGumShieldPosition: normalizedDetails.worksheetGumShieldPosition,
          worksheetLipShieldPosition: normalizedDetails.worksheetLipShieldPosition,
          projectedFractions: site.projectedFractions ?? null
        };
      })
    };

    return this.repository.saveDocumentOnlyRecord(normalizedInput);
  }

  deleteDocumentOnlyRecord(recordId: string) {
    this.assertUnlocked();
    const detail = this.repository.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      return;
    }

    const filePaths = detail.files.map((file) => this.resolveAssetPath(file.fileAsset));
    this.repository.deleteDocumentOnlyRecord(recordId);
    for (const filePath of filePaths) {
      if (!filePath) {
        continue;
      }
      this.assetStore.deleteFile(filePath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(filePath), this.assetStore.rootDir);
    }

    const recordRoot = path.join(this.assetStore.rootDir, "document-only", encodeURIComponent(recordId));
    if (this.assetStore.directoryExists(recordRoot)) {
      this.assetStore.removeDirectory(recordRoot);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(recordRoot), this.assetStore.rootDir);
    }
  }

  archivePatient(patientId: string) {
    this.assertUnlocked();
    this.repository.setPatientStatus(patientId, "archived");
  }

  restorePatient(patientId: string) {
    this.assertUnlocked();
    this.repository.setPatientStatus(patientId, "active");
  }

  deletePatient(patientId: string) {
    this.assertUnlocked();
    this.repository.setPatientStatus(patientId, "deleted");
  }

  permanentlyDeletePatient(patientId: string) {
    this.assertUnlocked();
    const assetSet = this.repository.getPatientAssetRecordSet(patientId);
    const pdfPaths = assetSet.courses.flatMap((course) =>
      course.visits.flatMap((visit) => visit.pdfs.map((pdf) => this.resolveAssetPath(pdf.fileAsset)).filter(Boolean) as string[])
    );
    const attachmentPaths = assetSet.courses.flatMap((course) =>
      course.visits.flatMap((visit) =>
        visit.attachments.map((attachment) => this.resolveAssetPath(attachment.fileAsset)).filter(Boolean) as string[]
      )
    );
    const photoPaths = assetSet.courses.flatMap((course) =>
      course.visits.flatMap((visit) => visit.photos.map((photo) => this.resolveAssetPath(photo.imageAsset)).filter(Boolean) as string[])
    );
    const documentPaths = assetSet.courses.flatMap((course) =>
      course.documents.map((document) => this.resolveAssetPath(document.fileAsset)).filter(Boolean) as string[]
    );

    this.repository.hardDeletePatientRecords(patientId);

    this.assetStore.deleteFiles(pdfPaths);
    this.assetStore.deleteFiles(attachmentPaths);
    this.assetStore.deleteFiles(photoPaths);
    this.assetStore.deleteFiles(documentPaths);
    const facePhotoPath = this.resolveAssetPath(assetSet.patient?.facePhoto ?? null);
    if (facePhotoPath) {
      this.assetStore.deleteFile(facePhotoPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(facePhotoPath), this.assetStore.rootDir);
    }

    const patientStorageDir = path.join(this.assetStore.rootDir, "patients", patientId);
    this.assetStore.removeDirectory(patientStorageDir);
    for (const pdfPath of pdfPaths) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(pdfPath), path.dirname(path.dirname(pdfPath)));
    }
    for (const assetPath of [...attachmentPaths, ...photoPaths, ...documentPaths]) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(assetPath), this.assetStore.rootDir);
    }
  }

  saveCourse(input: CourseInput) {
    this.assertUnlocked();
        const normalizedInput: CourseInput = {
          ...input,
          sites: ensureUniqueCourseSiteIds(input.sites).map((site) => ({
            ...site,
            ...normalizeVacLokPlacement(site.additionalDevices, site.worksheetPositioning),
            ...normalizeWorksheetDeviceDetailsForSite({
              additionalDevices: site.additionalDevices,
              worksheetEyeShieldType: site.worksheetEyeShieldType,
              worksheetGumShieldPosition: site.worksheetGumShieldPosition,
              worksheetLipShieldPosition: site.worksheetLipShieldPosition
            }),
            worksheetVacLokArea: normalizeVacLokAreaValue(site.worksheetVacLokArea),
            icd10: normalizeIcd10(site.icd10),
            lesionSize: formatMeasurement(site.lesionSize),
          cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
        machine: getDefaultMachine(site.machine),
        treatmentDepth: getDefaultTreatmentDepth(site.treatmentDepth),
        numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", site.cutoutSize)
      }))
    };
    const course = this.repository.saveCourse(normalizedInput);
    this.repository.trimCourseTreatmentAppointments(course.id, course.prescribedFractions);
    return this.repository.fetchCourse(course.id) ?? course;
  }

  completeCourse(courseId: string) {
    this.assertUnlocked();
    this.repository.setCourseStatus(courseId, "completed", todayIso());
  }

  restoreCourse(courseId: string) {
    this.assertUnlocked();
    this.repository.setCourseStatus(courseId, "active", null);
  }

  deleteCourse(courseId: string) {
    this.assertUnlocked();
    const assetSet = this.repository.getCourseAssetRecordSet(courseId);
    if (!assetSet) {
      return;
    }

    this.repository.deleteCourseRecords(courseId);

    const pdfPaths = assetSet.visits.flatMap((visit) =>
      visit.pdfs.map((pdf) => this.resolveAssetPath(pdf.fileAsset)).filter(Boolean) as string[]
    );
    const attachmentPaths = assetSet.visits.flatMap((visit) =>
      visit.attachments.map((attachment) => this.resolveAssetPath(attachment.fileAsset)).filter(Boolean) as string[]
    );
    const photoPaths = assetSet.visits.flatMap((visit) =>
      visit.photos.map((photo) => this.resolveAssetPath(photo.imageAsset)).filter(Boolean) as string[]
    );
    const documentPaths = assetSet.documents
      .map((document) => this.resolveAssetPath(document.fileAsset))
      .filter(Boolean) as string[];
    this.assetStore.deleteFiles(pdfPaths);
    this.assetStore.deleteFiles(attachmentPaths);
    this.assetStore.deleteFiles(photoPaths);
    this.assetStore.deleteFiles(documentPaths);

    const courseFolder = path.join(this.assetStore.rootDir, "patients", assetSet.course.patientId, "courses", courseId);
    this.assetStore.removeDirectory(courseFolder);
    for (const pdfPath of pdfPaths) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(pdfPath), path.dirname(path.dirname(pdfPath)));
    }
    for (const assetPath of [...attachmentPaths, ...photoPaths, ...documentPaths]) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(assetPath), this.assetStore.rootDir);
    }
    this.assetStore.cleanupEmptyDirectoryChain(path.dirname(courseFolder), this.assetStore.rootDir);
  }

  buildVisitDraft(
    courseId: string,
    mode: "next_treatment" | "consult_sim" = "next_treatment",
    existingVisitId?: string,
    options: VisitDraftOptions = {}
  ) {
    this.assertUnlocked();
    if (existingVisitId) {
      return this.loadExistingVisit(existingVisitId);
    }

    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }
    if (course.status === "pending") {
      throw new Error("Finish course setup before starting the sim / consult note.");
    }

    const patient = this.repository.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = this.repository.fetchSites([courseId]);
    const visits = this.repository.fetchVisitsByCourseIds([courseId]);
    const hasConsultVisit = visits.some((visit) => visit.note.noteType === "consult_sim");
    const currentFraction = getCurrentFraction(visits);
    const scheduleDates = this.repository.syncCourseScheduleDates(course.id);
    const hasPlannedConsult = Boolean(scheduleDates.simConsultDate || course.simConsultDate);
    const scheduledTreatmentNumber =
      mode !== "consult_sim" && typeof options.treatmentNumber === "number" && options.treatmentNumber > 0
        ? Math.trunc(options.treatmentNumber)
        : null;
    const shouldStartWithConsult =
      scheduledTreatmentNumber === null &&
      mode === "next_treatment" &&
      !hasConsultVisit &&
      currentFraction === 0 &&
      (hasPlannedConsult || course.prescribedFractions <= 0);
    const treatmentNumber =
      mode === "consult_sim" || shouldStartWithConsult
        ? null
        : scheduledTreatmentNumber ?? getNextTreatmentNumber(visits);
    if (mode === "next_treatment" && treatmentNumber === null) {
      if (!shouldStartWithConsult) {
        throw new Error("This course has reached the maximum treatment number.");
      }
    }

    const noteType = mode === "consult_sim" || shouldStartWithConsult ? "consult_sim" : getSuggestedNoteType(treatmentNumber);
    const existingSlotVisit = visits
      .filter((visit) => (visit.note.treatmentNumber ?? null) === (treatmentNumber ?? null))
      .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
    if (existingSlotVisit) {
      return this.loadExistingVisit(existingSlotVisit.note.id);
    }
      const courseDocuments = noteType === "consult_sim" ? this.repository.fetchCourseDocuments(courseId) : [];
      let siteSnapshots = applyAutoNumberOfBlocks(noteType, buildSiteSnapshots(sites, treatmentNumber));
      const settings = this.repository.getSettingsRecord();
      const latestConsultVisit = visits
        .filter((visit) => visit.note.noteType === "consult_sim")
        .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
      const projectedFractionsFromConsult = latestConsultVisit?.note.structuredFields.projectedFractionsInput ?? null;
      const projectedFractionsBySiteFromConsult = latestConsultVisit?.note.structuredFields.siteSnapshots ?? [];
      const mostRecentVisitDate =
        visits
          .map((visit) => visit.note.visitDate)
          .filter(Boolean)
          .sort()
        .at(-1) ?? course.startDate;
    const structuredFields = buildDefaultStructuredFields(noteType, siteSnapshots, settings.supervisingPhysician, {
      biopsyDate: course.startDate,
      lastTreatmentDate: mostRecentVisitDate
    });
    structuredFields.siteSnapshots = structuredFields.siteSnapshots.map((site) => ({
      ...site,
      biopsyDate: site.biopsyDate || course.startDate || ""
    }));
    if (noteType === "consult_sim" && scheduleDates.treatmentStartDate) {
      structuredFields.startRadiationDate = scheduleDates.treatmentStartDate;
    }
      if (noteType !== "consult_sim") {
        if (treatmentNumber === 1) {
          siteSnapshots = fillMissingSitePrescribedFractions(
            siteSnapshots.map((site) => {
              const projectedSite = projectedFractionsBySiteFromConsult.find(
                (snapshot) => snapshot.siteNumber === site.siteNumber
              );
              return {
                ...site,
                prescribedFractions:
                  projectedSite?.prescribedFractions ??
                  site.prescribedFractions
              };
            }),
            projectedFractionsFromConsult
          );
          siteSnapshots = siteSnapshots.map((site) =>
            applyAutomaticDoseValuesToSiteSnapshot(site, treatmentNumber, site.prescribedFractions ?? null)
          );
          structuredFields.siteSnapshots = siteSnapshots.map((site) => ({
            ...site,
            biopsyDate: site.biopsyDate || course.startDate || ""
          }));
          structuredFields.prescribedFractionsInput = getMaxSitePrescribedFractions(structuredFields.siteSnapshots);
        } else if (course.prescribedFractions <= 0) {
          structuredFields.prescribedFractionsInput = course.prescribedFractions > 0 ? course.prescribedFractions : null;
        }
        const finalTreatmentFraction =
          course.prescribedFractions > 0
            ? course.prescribedFractions
            : getMaxSitePrescribedFractions(structuredFields.siteSnapshots);
        structuredFields.finalTreatment = isFinalTreatmentEligible(treatmentNumber, finalTreatmentFraction);
      }

      const note: VisitInput = {
        patientId: patient.id,
        courseId: course.id,
        visitDate: options.visitDate || (noteType === "consult_sim" ? scheduleDates.simConsultDate || course.simConsultDate || todayIso() : todayIso()),
        noteType,
        treatmentNumber,
        status: "draft",
      therapistName: settings.defaultTherapist,
      vitals: createEmptyVitals(),
      structuredFields,
      generatedText: "",
      editedText: "",
      newPhotoUploads: [],
      newAttachmentUploads: []
    };
    const generatedText = this.renderVisitText(patient, course, note);
    note.generatedText = generatedText;
    note.editedText = generatedText;

    return {
      patient,
      course,
      sites,
      courseDocuments,
      note,
      existingPhotos: [],
      existingAttachments: [],
      generatedPdfs: [],
      templateKey: getTemplateKey(course.courseType, note.noteType)
    } satisfies VisitEditorState;
  }

  saveVisit(input: VisitInput) {
    this.assertUnlocked();
    const patient = this.repository.fetchPatient(input.patientId);
    let course = this.repository.fetchCourse(input.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    const normalizedSiteSnapshots = (
      input.structuredFields.siteSnapshots.length === 1
        ? input.structuredFields.siteSnapshots.map((site) => ({
            ...site,
            prescribedFractions:
              input.noteType === "consult_sim"
                ? input.structuredFields.projectedFractionsInput ?? site.prescribedFractions ?? undefined
                : input.structuredFields.prescribedFractionsInput ?? site.prescribedFractions ?? undefined
          }))
        : input.structuredFields.siteSnapshots
    ).map((site) =>
      input.noteType === "consult_sim"
        ? applyAutomaticDoseValuesToSiteSnapshot(
            { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
            null,
            site.prescribedFractions ?? input.structuredFields.projectedFractionsInput ?? null
          )
        : applyAutomaticDoseValuesToSiteSnapshot(
            { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
            input.treatmentNumber,
            site.prescribedFractions ?? null
          )
    );

    const prescribedFractionsInput =
      input.noteType !== "consult_sim"
        ? input.structuredFields.prescribedFractionsInput ??
          getMaxSitePrescribedFractions(normalizedSiteSnapshots)
        : null;
    const projectedFractionsInput =
      input.noteType === "consult_sim"
        ? input.structuredFields.projectedFractionsInput ??
          getMaxSitePrescribedFractions(normalizedSiteSnapshots)
        : input.structuredFields.projectedFractionsInput ?? null;

    let courseSites = this.repository.fetchSites([course.id]);
    let courseUpdated = false;
    if (prescribedFractionsInput && prescribedFractionsInput > 0 && prescribedFractionsInput !== course.prescribedFractions) {
      this.repository.updateCoursePrescribedFractions(course.id, prescribedFractionsInput);
      this.repository.trimCourseTreatmentAppointments(course.id, prescribedFractionsInput);
      courseUpdated = true;
    }
    if (input.noteType !== "consult_sim") {
      for (const siteSnapshot of normalizedSiteSnapshots) {
        const sitePrescribedFractions = siteSnapshot.prescribedFractions ?? null;
        const storedSite = courseSites.find((site) => site.siteNumber === siteSnapshot.siteNumber);
        if (sitePrescribedFractions && sitePrescribedFractions > 0 && (storedSite?.prescribedFractions ?? null) !== sitePrescribedFractions) {
          this.repository.updateCourseSitePrescribedFractions(course.id, siteSnapshot.siteNumber, sitePrescribedFractions);
          courseUpdated = true;
        }
        if (
          (storedSite?.dailyDose ?? 0) !== siteSnapshot.dailyDose ||
          (storedSite?.totalDose ?? 0) !== siteSnapshot.totalDose
        ) {
          this.repository.updateCourseSiteDoseValues(
            course.id,
            siteSnapshot.siteNumber,
            siteSnapshot.dailyDose,
            siteSnapshot.totalDose
          );
          courseUpdated = true;
        }
      }
    }
    if (courseUpdated) {
      course = this.repository.fetchCourse(input.courseId);
      if (!course) {
        throw new Error("Visit context is incomplete.");
      }
      courseSites = this.repository.fetchSites([course.id]);
    }

      const settings = this.repository.getSettingsRecord();
      const finalTreatmentEligible =
        input.noteType !== "consult_sim" &&
        isFinalTreatmentEligible(input.treatmentNumber, course.prescribedFractions);
      const structuredFields = {
        ...input.structuredFields,
          additionalNotes: input.structuredFields.additionalNotes ?? "",
          finalTreatment: Boolean(input.structuredFields.finalTreatment) && finalTreatmentEligible,
          finalTreatmentNote:
            input.structuredFields.finalTreatmentNote?.trim() || getDefaultFinalTreatmentNote(),
          prescribedFractionsInput,
          projectedFractionsInput,
          biopsyDate: normalizedSiteSnapshots[0]?.biopsyDate || input.structuredFields.biopsyDate || "",
        lastTreatmentDate: input.structuredFields.lastTreatmentDate ?? "",
        examComment:
          input.noteType === "otv"
            ? input.structuredFields.examComment?.trim() || getDefaultOtvNote(normalizedSiteSnapshots)
            : input.structuredFields.examComment ?? "",
        physicsComment:
          input.structuredFields.physicsComment?.trim() ||
          getDefaultPhysicsComment(input.noteType),
        mipsNote: input.structuredFields.mipsNote?.trim() || getDefaultMipsNote(),
        supervisedBy:
          input.structuredFields.supervisedBy?.trim() || settings.supervisingPhysician,
        siteSnapshots: refreshVisitSiteSnapshots(
          input.noteType,
          courseSites.map((site) => ({
            ...site,
            cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize)
          })),
          input.treatmentNumber,
          normalizedSiteSnapshots.map((snapshot) => ({
            ...snapshot,
            cutoutSize: normalizeCutoutSizeLabel(snapshot.cutoutSize)
          })),
          input.structuredFields.biopsyDate || ""
        )
      };

    const slotVisits = this.repository
      .fetchVisitsByCourseIds([input.courseId])
      .filter((visit) =>
        visit.note.courseId === input.courseId &&
        (visit.note.treatmentNumber ?? null) === (input.treatmentNumber ?? null)
      )
      .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt));
    const targetSlotVisit = input.id
      ? slotVisits.find((visit) => visit.note.id === input.id) ?? slotVisits[0] ?? null
      : slotVisits[0] ?? null;

    const normalizedInput: VisitInput = {
      ...input,
      id: targetSlotVisit?.note.id ?? input.id,
      therapistName: input.therapistName.trim(),
      vitals: formatVitals(input.vitals),
      structuredFields
    };

    const generatedText = this.renderVisitText(patient, course, normalizedInput);
    const editedText = normalizedInput.editedText.trim() || generatedText;
    const savedVisit = this.repository.saveVisit(normalizedInput, generatedText, editedText);

    const existingPhotos = this.repository.fetchVisitPhotos(savedVisit.id);
    const photoBaseName = this.buildVisitPhotoBaseName(normalizedInput);
    normalizedInput.newPhotoUploads.forEach((upload, index) => {
      const imageLabel = existingPhotos.length + index === 0 ? photoBaseName : `${photoBaseName}-${existingPhotos.length + index + 1}`;
      const photoCaption =
        upload.caption && upload.caption.trim() && upload.caption.trim() !== upload.name
          ? upload.caption.trim()
          : photoBaseName;
      const filePath = this.assetStore.saveUpload(
        upload,
        this.assetStore.getVisitPhotosDir(patient.id, course.id, savedVisit.id),
        imageLabel
      );
      (this.repository as AssetAwareStructuredDataStore).addVisitPhoto(
        savedVisit.id,
        this.assetStore.createAssetReference(filePath, "visit_photo")!,
        existingPhotos.length + index + 1,
        photoCaption
      );
    });

    const existingAttachments = this.repository.fetchVisitAttachments(savedVisit.id);
    const attachmentBaseName = this.buildVisitAttachmentBaseName(normalizedInput);
    normalizedInput.newAttachmentUploads.forEach((upload, index) => {
      const attachmentLabel =
        existingAttachments.length + index === 0
          ? attachmentBaseName
          : `${attachmentBaseName}-${existingAttachments.length + index + 1}`;
      const filePath = this.assetStore.saveUpload(
        upload,
        this.assetStore.getVisitAttachmentsDir(patient.id, course.id, savedVisit.id),
        attachmentLabel
      );
      (this.repository as AssetAwareStructuredDataStore).addVisitAttachment(
        savedVisit.id,
        this.assetStore.createAssetReference(filePath, "visit_attachment")!,
        existingAttachments.length + index + 1,
        upload.caption?.trim() || upload.name,
        upload.mimeType,
        upload.name
      );
    });

    const duplicateSlotVisits = this.repository
      .fetchVisitsByCourseIds([input.courseId])
      .filter((visit) =>
        visit.note.id !== savedVisit.id &&
        visit.note.courseId === input.courseId &&
        (visit.note.treatmentNumber ?? null) === (savedVisit.treatmentNumber ?? null)
      );

    for (const duplicate of duplicateSlotVisits) {
      this.deleteVisit(duplicate.note.id);
    }

    return this.repository.fetchVisit(savedVisit.id)!;
  }

  deleteVisit(visitId: string) {
    this.assertUnlocked();
    const assetSet = this.repository.getVisitAssetRecordSet(visitId);
    if (!assetSet) {
      return;
    }

    this.repository.deleteVisitRecords(visitId);

    const pdfPaths = assetSet.pdfs.map((pdf) => this.resolveAssetPath(pdf.fileAsset)).filter(Boolean) as string[];
    const attachmentPaths = assetSet.attachments
      .map((attachment) => this.resolveAssetPath(attachment.fileAsset))
      .filter(Boolean) as string[];
    const photoPaths = assetSet.photos.map((photo) => this.resolveAssetPath(photo.imageAsset)).filter(Boolean) as string[];
    this.assetStore.deleteFiles(pdfPaths);
    this.assetStore.deleteFiles(attachmentPaths);
    this.assetStore.deleteFiles(photoPaths);

    const visitFolder = this.assetStore.getVisitWorkspaceDir(assetSet.note.patientId, assetSet.note.courseId, assetSet.note.id);
    this.assetStore.removeDirectory(visitFolder);
    for (const pdfPath of pdfPaths) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(pdfPath), path.dirname(path.dirname(pdfPath)));
    }
    for (const assetPath of [...attachmentPaths, ...photoPaths]) {
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(assetPath), this.assetStore.rootDir);
    }
    this.assetStore.cleanupEmptyDirectoryChain(path.dirname(visitFolder), this.assetStore.rootDir);
  }

  async generatePdf(visitId: string): Promise<PdfGenerationResult> {
    this.assertUnlocked();
    const visit = this.repository.fetchVisit(visitId);
    if (!visit) {
      throw new Error("Visit not found.");
    }
    if (visit.status === "finalized") {
      this.removeSupersededFinalizedVisits(visit);
    }

    const patient = this.repository.fetchPatient(visit.patientId);
    const course = this.repository.fetchCourse(visit.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    const photos = this.repository.fetchVisitPhotos(visitId);
    const attachments = this.repository.fetchVisitAttachments(visitId);
    const linkedCourseDocuments = visit.noteType === "consult_sim" ? this.repository.fetchCourseDocuments(course.id) : [];
    const existingPdfs = this.repository.fetchGeneratedPdfs(visitId);
    const versionNumber = existingPdfs.length + 1;
    const pdfBaseName = this.buildPdfBaseName(patient, visit);
    const libraryRoot = this.getPatientNoteLibraryRoot();
    const categoryFolder = this.getPdfCategoryFolder(visit.noteType);
    const patientFolder = this.buildPatientFolderName(patient);
    const outputPath = path.join(
      libraryRoot,
      categoryFolder,
      patientFolder,
      `${pdfBaseName}-v${versionNumber}.pdf`
    );

    const pdfBytes = await buildVisitPdf({
      noteText: visit.editedText || visit.generatedText,
      photoInputs: photos.map((photo) => ({
        image: this.readPdfAssetInput(photo.imageAsset, `visit photo ${photo.id}`),
        caption: photo.caption || `Treatment Photo ${photo.sortOrder}`
      })),
      attachmentInputs: [
        ...attachments.map((attachment) => ({
          file: this.readPdfAssetInput(attachment.fileAsset, `visit attachment ${attachment.id}`, attachment.originalName),
          caption: attachment.caption || attachment.originalName,
          mimeType: attachment.mimeType,
          originalName: attachment.originalName
        })),
        ...linkedCourseDocuments.map((document) => ({
          file: this.readPdfAssetInput(document.fileAsset, `course document ${document.id}`, document.originalName),
          caption: document.caption || document.originalName,
          mimeType: document.mimeType,
          originalName: document.originalName
        }))
      ],
      logoInput: this.readPdfOptionalPathInput(this.getCurrentNoteLogoPath(), "note logo")
    });

    this.assetStore.writeBinaryFile(outputPath, pdfBytes);
    (this.repository as AssetAwareStructuredDataStore).insertGeneratedPdf(
      visitId,
      this.assetStore.createAssetReference(outputPath, "generated_pdf")!,
      versionNumber
    );
    const persistedPdf = this.repository.fetchGeneratedPdfs(visitId).find((pdf) => pdf.versionNumber === versionNumber);
    if (!persistedPdf) {
      throw new Error("Generated PDF record could not be reloaded after save.");
    }
    return {
      visitId,
      pdfAsset: persistedPdf.fileAsset,
      versionNumber
    };
  }

  async generateSimWorksheet(visitId: string) {
    this.assertUnlocked();
    const visit = this.repository.fetchVisit(visitId);
    if (!visit) {
      throw new Error("Visit not found.");
    }
    if (visit.noteType !== "consult_sim") {
      throw new Error("Sim worksheet is only available for Sim / Consult visits.");
    }

      const patient = this.repository.fetchPatient(visit.patientId);
      const course = this.repository.fetchCourse(visit.courseId);
      if (!patient || !course) {
        throw new Error("Visit context is incomplete.");
      }

      const currentCourseSites = this.repository.fetchSites([course.id]);
        const latestSnapshots = fillMissingSitePrescribedFractions(
          applyAutoNumberOfBlocks(
            visit.noteType,
            buildSiteSnapshots(currentCourseSites, visit.treatmentNumber)
          ).map((site) => {
            const existingSnapshot = visit.structuredFields.siteSnapshots.find((snapshot) => snapshot.siteNumber === site.siteNumber);
            return {
              ...site,
              biopsyDate: existingSnapshot?.biopsyDate || visit.structuredFields.biopsyDate || course.startDate || "",
              prescribedFractions: existingSnapshot?.prescribedFractions ?? site.prescribedFractions
            };
          }),
          visit.structuredFields.projectedFractionsInput ?? null
        );

      const worksheet = await buildSimWorksheetPdf({
        patient,
        course,
        visit: {
          ...visit,
          structuredFields: {
            ...visit.structuredFields,
            siteSnapshots: latestSnapshots
          }
        }
      });
      const attachmentsDir = this.assetStore.getVisitAttachmentsDir(patient.id, course.id, visit.id);
      this.assetStore.ensureDirectory(attachmentsDir);
      const outputPath = path.join(attachmentsDir, worksheet.fileName);

      const existingWorksheetAttachments = this.repository
        .fetchVisitsByCourseIds([course.id])
        .flatMap((courseVisit) => courseVisit.attachments)
        .filter((attachment) => attachment.originalName === worksheet.fileName);
      for (const attachment of existingWorksheetAttachments) {
        this.repository.deleteVisitAttachmentRecord(attachment.id);
        const attachmentPath = this.resolveAssetPath(attachment.fileAsset);
        if (attachmentPath) {
        this.assetStore.deleteFile(attachmentPath);
      }
    }

    this.assetStore.writeBinaryFile(outputPath, worksheet.bytes);
    const nextSortOrder = this.repository.fetchVisitAttachments(visit.id).length + 1;
    (this.repository as AssetAwareStructuredDataStore).addVisitAttachment(
      visit.id,
      this.assetStore.createAssetReference(outputPath, "visit_attachment")!,
      nextSortOrder,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );

    const created = this.repository
      .fetchVisitAttachments(visit.id)
      .find((attachment) => attachment.originalName === worksheet.fileName);
    if (!created) {
      throw new Error("Sim worksheet attachment could not be reloaded after save.");
    }

    return created;
  }

  async generateDocumentOnlyConsent(recordId: string) {
    this.assertUnlocked();
    const detail = this.repository.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "consent_form") ?? null;
    const documentsDir = this.assetStore.getDocumentOnlyFilesDir(recordId);
    this.assetStore.ensureDirectory(documentsDir);

    const consentForm = await buildConsentFormPdf({
      patient,
      course,
      sites
    });
    const outputPath = path.join(documentsDir, consentForm.fileName);
    this.assetStore.writeBinaryFile(outputPath, consentForm.bytes);

    const persistedFile = this.repository.upsertDocumentOnlyFile(
      recordId,
      "consent_form",
      outputPath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingFile ? this.resolveAssetPath(existingFile.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

    return persistedFile;
  }

  async finalizeDocumentOnlyConsent(recordId: string, signing: ConsentSigningInput) {
    this.assertUnlocked();
    const detail = this.repository.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "consent_form") ?? null;
    const documentsDir = this.assetStore.getDocumentOnlyFilesDir(recordId);
    this.assetStore.ensureDirectory(documentsDir);

    const consentForm = await buildSignedConsentFormPdf({
      patient,
      course,
      sites,
      signing
    });
    const outputPath = path.join(documentsDir, consentForm.fileName);
    this.assetStore.writeBinaryFile(outputPath, consentForm.bytes);

    const persistedFile = this.repository.upsertDocumentOnlyFile(
      recordId,
      "consent_form",
      outputPath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingFile ? this.resolveAssetPath(existingFile.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

    return persistedFile;
  }

  async generateDocumentOnlySimWorksheet(recordId: string) {
    this.assertUnlocked();
    const detail = this.repository.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, visit } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "sim_worksheet") ?? null;
    const documentsDir = this.assetStore.getDocumentOnlyFilesDir(recordId);
    this.assetStore.ensureDirectory(documentsDir);

    const worksheet = await buildSimWorksheetPdf({
      patient,
      course,
      visit: {
        ...visit,
        id: `doc_visit_${recordId}`,
        status: "draft",
        createdAt: detail.record.createdAt,
        updatedAt: detail.record.updatedAt,
        pdfAsset: null,
        generatedText: "",
        editedText: ""
      }
    });
    const outputPath = path.join(documentsDir, worksheet.fileName);
    this.assetStore.writeBinaryFile(outputPath, worksheet.bytes);

    const persistedFile = this.repository.upsertDocumentOnlyFile(
      recordId,
      "sim_worksheet",
      outputPath,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );

    const previousPath = existingFile ? this.resolveAssetPath(existingFile.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

    return persistedFile;
  }

  async generateConsentForm(courseId: string) {
    this.assertUnlocked();
    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = this.repository.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = this.repository.fetchSites([course.id]);
    const existingDocument = this.repository
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const documentsDir = this.assetStore.getCourseDocumentsDir(patient.id, course.id);
    this.assetStore.ensureDirectory(documentsDir);

    const consentForm = await buildConsentFormPdf({
      patient,
      course,
      sites
    });
    const outputPath = path.join(documentsDir, consentForm.fileName);
    this.assetStore.writeBinaryFile(outputPath, consentForm.bytes);

    const persistedDocument = (this.repository as AssetAwareStructuredDataStore).upsertCourseDocument(
      course.id,
      "consent_form",
      this.assetStore.createAssetReference(outputPath, "course_document")!,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.resolveAssetPath(existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

      return persistedDocument;
    }

  async generateCourseSimWorksheet(courseId: string) {
    this.assertUnlocked();
    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = this.repository.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = this.repository.fetchSites([course.id]);
    const settings = this.repository.toSettingsView(this.repository.getSettingsRecord());
    const existingDocument = this.repository
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "sim_worksheet") ?? null;
    const siteSnapshots = fillMissingSitePrescribedFractions(
      applyAutoNumberOfBlocks("consult_sim", buildSiteSnapshots(sites, null)),
      null
    );
    const structuredFields = {
      ...buildDefaultStructuredFields("consult_sim", siteSnapshots, settings.supervisingPhysician, {
        biopsyDate: course.startDate || "",
        lastTreatmentDate: course.startDate || ""
      }),
      siteSnapshots,
      projectedFractionsInput:
        siteSnapshots.find((site) => typeof site.prescribedFractions === "number" && site.prescribedFractions > 0)
          ?.prescribedFractions ?? null
    };
    const worksheet = await buildSimWorksheetPdf({
      patient,
      course,
      visit: {
        id: `course_worksheet_${course.id}`,
        patientId: patient.id,
        courseId: course.id,
        visitDate: course.simConsultDate || course.startDate || todayIso(),
        noteType: "consult_sim",
        treatmentNumber: null,
        status: "draft",
        therapistName: settings.defaultTherapist,
        vitals: createEmptyVitals(),
        structuredFields,
        generatedText: "",
        editedText: "",
        pdfAsset: null,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt
      }
    });

    const documentsDir = this.assetStore.getCourseDocumentsDir(patient.id, course.id);
    this.assetStore.ensureDirectory(documentsDir);
    const preferredPath = path.join(documentsDir, worksheet.fileName);
    let outputPath = preferredPath;
    try {
      this.assetStore.writeBinaryFile(outputPath, worksheet.bytes);
    } catch (error) {
      if (!isLockedFileError(error)) {
        throw error;
      }
      outputPath = buildVersionedDocumentPath(preferredPath);
      this.assetStore.writeBinaryFile(outputPath, worksheet.bytes);
    }

    const persistedDocument = (this.repository as AssetAwareStructuredDataStore).upsertCourseDocument(
      course.id,
      "sim_worksheet",
      this.assetStore.createAssetReference(outputPath, "course_document")!,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );

    const previousPath = existingDocument ? this.resolveAssetPath(existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      try {
        this.assetStore.deleteFile(previousPath);
        this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
      } catch (error) {
        if (!isLockedFileError(error)) {
          throw error;
        }
      }
    }

    return persistedDocument;
  }

  async finalizeConsentForm(courseId: string, signing: ConsentSigningInput) {
    this.assertUnlocked();
    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = this.repository.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = this.repository.fetchSites([course.id]);
    const existingDocument = this.repository
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const documentsDir = this.assetStore.getCourseDocumentsDir(patient.id, course.id);
    this.assetStore.ensureDirectory(documentsDir);

    const consentForm = await buildSignedConsentFormPdf({
      patient,
      course,
      sites,
      signing
    });
    const outputPath = path.join(documentsDir, consentForm.fileName);
    this.assetStore.writeBinaryFile(outputPath, consentForm.bytes);

    const persistedDocument = (this.repository as AssetAwareStructuredDataStore).upsertCourseDocument(
      course.id,
      "consent_form",
      this.assetStore.createAssetReference(outputPath, "course_document")!,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.resolveAssetPath(existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

    return persistedDocument;
  }

  async uploadConsentForm(courseId: string, upload: StoredAssetUpload) {
    this.assertUnlocked();
    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = this.repository.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const existingDocument = this.repository
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const documentsDir = this.assetStore.getCourseDocumentsDir(patient.id, course.id);
    this.assetStore.ensureDirectory(documentsDir);

    const consentForm = await buildUploadedConsentPdf(upload, patient);
    const outputPath = path.join(documentsDir, consentForm.fileName);
    this.assetStore.writeBinaryFile(outputPath, consentForm.bytes);

    const persistedDocument = (this.repository as AssetAwareStructuredDataStore).upsertCourseDocument(
      course.id,
      "consent_form",
      this.assetStore.createAssetReference(outputPath, "course_document")!,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.resolveAssetPath(existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== outputPath) {
      this.assetStore.deleteFile(previousPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(previousPath), this.assetStore.rootDir);
    }

    return persistedDocument;
  }

  deleteConsentForm(courseId: string) {
    this.assertUnlocked();
    const course = this.repository.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const document = this.repository
      .fetchCourseDocuments(course.id)
      .find((item) => item.documentType === "consent_form");
    if (!document) {
      return;
    }

    this.repository.deleteCourseDocumentRecord(document.id);
    const documentPath = this.resolveAssetPath(document.fileAsset);
    if (documentPath) {
      this.assetStore.deleteFile(documentPath);
      this.assetStore.cleanupEmptyDirectoryChain(path.dirname(documentPath), this.assetStore.rootDir);
    }
  }

  getVisitFolder(visitId: string): string {
    this.assertUnlocked();
    const visit = this.repository.fetchVisit(visitId);
    if (!visit) throw new Error("Visit not found.");
    const patient = this.repository.fetchPatient(visit.patientId);
    const course = this.repository.fetchCourse(visit.courseId);
    if (!patient || !course) throw new Error("Visit context is incomplete.");
    const folder = path.join(this.assetStore.getVisitWorkspaceDir(patient.id, course.id, visit.id), "pdfs");
    this.assetStore.ensureDirectory(folder);
    return folder;
  }

  removeVisitPhoto(photoId: string) {
    this.assertUnlocked();
    const photo = this.repository.fetchVisitPhoto(photoId);
    if (!photo) {
      return;
    }

    this.repository.deleteVisitPhotoRecord(photoId);
    const photoPath = this.requireAssetPath(photo.imageAsset, `visit photo ${photo.id}`);
    this.assetStore.deleteFile(photoPath);
    this.assetStore.cleanupEmptyDirectoryChain(path.dirname(photoPath), this.assetStore.rootDir);
  }

  removeVisitAttachment(attachmentId: string) {
    this.assertUnlocked();
    const attachment = this.repository.fetchVisitAttachment(attachmentId);
    if (!attachment) {
      return;
    }
    const attachmentName = `${attachment.originalName || ""} ${attachment.caption || ""}`.toLowerCase();
    if (attachmentName.includes("sim worksheet")) {
      return;
    }

    this.repository.deleteVisitAttachmentRecord(attachmentId);
    const attachmentPath = this.requireAssetPath(attachment.fileAsset, `visit attachment ${attachment.id}`);
    this.assetStore.deleteFile(attachmentPath);
    this.assetStore.cleanupEmptyDirectoryChain(path.dirname(attachmentPath), this.assetStore.rootDir);
  }

  getSettingsPayload(): SettingsPayload {
    this.assertUnlocked();
    return {
      settings: this.repository.toSettingsView(this.repository.getSettingsRecord()),
      savedOptions: this.repository.getSavedOptions()
    };
  }

  saveSettings(input: SettingsPayload["settings"]) {
    this.assertUnlocked();
    const currentSettings = this.repository.toSettingsView(this.repository.getSettingsRecord());
    let logoPath = this.resolveAssetPath(currentSettings.dermatologyOfficeLogoAsset);

    if (input.removeDermatologyOfficeLogo) {
      if (logoPath) {
        this.assetStore.deleteFile(logoPath);
        this.assetStore.cleanupEmptyDirectoryChain(path.dirname(logoPath), this.assetStore.rootDir);
      }
      logoPath = null;
    }

    if (input.dermatologyOfficeLogoUpload) {
      const nextLogoPath = this.assetStore.saveUpload(
        input.dermatologyOfficeLogoUpload,
        this.assetStore.getSettingsBrandingDir(),
        "dermatology-office-logo"
      );
      if (logoPath && logoPath !== nextLogoPath) {
        this.assetStore.deleteFile(logoPath);
        this.assetStore.cleanupEmptyDirectoryChain(path.dirname(logoPath), this.assetStore.rootDir);
      }
      logoPath = nextLogoPath;
    }

      (this.repository as AssetAwareStructuredDataStore).updateSettings({
        ...input,
        dermatologyOfficeLogoAsset: this.assetStore.createAssetReference(logoPath, "settings_logo"),
        dermatologyOfficeLogoUpload: undefined,
        removeDermatologyOfficeLogo: undefined
      });

    return this.repository.toSettingsView(this.repository.getSettingsRecord());
  }

  rememberSavedOption(type: SavedOptionType, value: string) {
    this.assertUnlocked();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    this.repository.rememberOption(type, trimmed, normalizeOptionValue(trimmed));
  }

  deleteSavedOption(optionId: string) {
    this.assertUnlocked();
    this.repository.deleteSavedOption(optionId);
  }

  getTemplates() {
    this.assertUnlocked();
    return this.repository.getTemplates();
  }

  preparePatientArchive(patientId: string): PreparedPatientArchiveDescription {
    this.assertUnlocked();
    return this.archivePreparationService.preparePatientArchive(patientId);
  }

  async exportPatientArchive(patientId: string): Promise<PatientArchiveExportResult> {
    this.assertUnlocked();
    const prepared = this.archivePreparationService.preparePatientArchive(patientId);
    return this.archiveExportService.exportPreparedArchive(prepared);
  }

  async readPatientArchive(archive: PatientArchiveIoHandle): Promise<PatientArchiveReadResult> {
    this.assertUnlocked();
    return this.archiveReaderService.readArchive(archive);
  }

  async preflightPatientArchive(archive: PatientArchiveIoHandle): Promise<PatientArchivePreflightResult> {
    this.assertUnlocked();
    return this.archiveRestoreService.preflightArchive(archive);
  }

  async restorePatientArchive(archive: PatientArchiveIoHandle): Promise<PatientArchiveRestoreResult> {
    this.assertUnlocked();
    return this.archiveRestoreService.restoreArchive(archive);
  }

  saveTemplate(templateId: string, templateText: string) {
    this.assertUnlocked();
    const validation = validateTemplate(templateText);
    if (!validation.isValid) {
      throw new Error(`Unknown placeholders: ${validation.unknownTokens.join(", ")}`);
    }
    return this.repository.saveTemplate(templateId, templateText);
  }

  resetTemplate(templateId: string) {
    this.assertUnlocked();
    return this.repository.resetTemplate(templateId);
  }

  private loadExistingVisit(visitId: string): VisitEditorState {
      const visit = this.repository.fetchVisit(visitId);
      if (!visit) {
        throw new Error("Visit not found.");
      }

    const patient = this.repository.fetchPatient(visit.patientId);
    const course = this.repository.fetchCourse(visit.courseId);
      if (!patient || !course) {
        throw new Error("Visit context is incomplete.");
      }

      const sites = this.repository.fetchSites([course.id]);
      const courseDocuments = visit.noteType === "consult_sim" ? this.repository.fetchCourseDocuments(course.id) : [];
      const scheduleDates = this.repository.syncCourseScheduleDates(course.id);
      const refreshedSiteSnapshots = refreshVisitSiteSnapshots(
        visit.noteType,
        sites,
        visit.treatmentNumber,
        visit.structuredFields.siteSnapshots,
        visit.structuredFields.biopsyDate || course.startDate || ""
      );
      const resolvedSiteSnapshots = fillMissingSitePrescribedFractions(
        refreshedSiteSnapshots,
        visit.noteType === "consult_sim"
          ? visit.structuredFields.projectedFractionsInput ?? null
          : visit.structuredFields.prescribedFractionsInput ??
              (course.prescribedFractions > 0 ? course.prescribedFractions : null)
      ).map((site) =>
        visit.noteType === "consult_sim"
          ? { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) }
          : applyAutomaticDoseValuesToSiteSnapshot(
              { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
              visit.treatmentNumber,
              site.prescribedFractions ?? null
            )
      );
      const settings = this.repository.getSettingsRecord();
      const finalTreatmentEligible =
        visit.noteType !== "consult_sim" &&
        isFinalTreatmentEligible(visit.treatmentNumber, course.prescribedFractions);
      const refreshedNote: VisitInput = {
        id: visit.id,
        patientId: visit.patientId,
        courseId: visit.courseId,
        visitDate: visit.noteType === "consult_sim" ? scheduleDates.simConsultDate || course.simConsultDate || visit.visitDate : visit.visitDate,
        noteType: visit.noteType,
        treatmentNumber: visit.treatmentNumber,
        status: visit.status,
        therapistName: visit.therapistName,
        vitals: visit.vitals,
        structuredFields: {
          ...visit.structuredFields,
          additionalNotes: visit.structuredFields.additionalNotes ?? "",
          finalTreatment: Boolean(visit.structuredFields.finalTreatment) && finalTreatmentEligible,
          finalTreatmentNote:
            visit.structuredFields.finalTreatmentNote?.trim() || getDefaultFinalTreatmentNote(),
          prescribedFractionsInput:
            visit.structuredFields.prescribedFractionsInput ??
            (visit.noteType !== "consult_sim"
              ? getMaxSitePrescribedFractions(resolvedSiteSnapshots) ??
                (course.prescribedFractions > 0 ? course.prescribedFractions : null)
              : null),
          projectedFractionsInput:
            visit.structuredFields.projectedFractionsInput ??
            (visit.noteType === "consult_sim" ? getMaxSitePrescribedFractions(resolvedSiteSnapshots) : null),
          biopsyDate: visit.structuredFields.biopsyDate ?? course.startDate ?? "",
          lastTreatmentDate: visit.structuredFields.lastTreatmentDate ?? course.startDate ?? "",
          startRadiationDate:
            visit.noteType === "consult_sim"
              ? scheduleDates.treatmentStartDate ?? visit.structuredFields.startRadiationDate ?? ""
              : visit.structuredFields.startRadiationDate ?? "",
          physicsComment:
            visit.structuredFields.physicsComment?.trim() ||
            getDefaultPhysicsComment(visit.noteType),
          examComment:
            visit.noteType === "otv"
              ? visit.structuredFields.examComment?.trim() || getDefaultOtvNote(resolvedSiteSnapshots)
              : visit.structuredFields.examComment ?? "",
          mipsNote: visit.structuredFields.mipsNote?.trim() || getDefaultMipsNote(),
          supervisedBy:
            visit.structuredFields.supervisedBy?.trim() || settings.supervisingPhysician,
          siteSnapshots: resolvedSiteSnapshots
        },
        generatedText: visit.generatedText,
        editedText: visit.editedText,
        newPhotoUploads: [],
        newAttachmentUploads: []
      };
      const generatedText = this.renderVisitText(patient, course, refreshedNote);
      const shouldRefreshEditedText = !visit.editedText.trim() || visit.editedText === visit.generatedText;

      return {
        patient,
        course,
        sites,
        courseDocuments,
        note: {
          ...refreshedNote,
          generatedText,
          editedText: shouldRefreshEditedText ? generatedText : visit.editedText
        },
        existingPhotos: this.repository.fetchVisitPhotos(visit.id),
        existingAttachments: this.repository.fetchVisitAttachments(visit.id),
        generatedPdfs: this.repository.fetchGeneratedPdfs(visit.id),
      templateKey: getTemplateKey(course.courseType, visit.noteType)
    };
  }

  private renderVisitText(
    patient: PatientRecord,
    course: TreatmentCourseRecord,
    note: VisitInput
  ) {
    const template = this.repository.getTemplate(getTemplateKey(course.courseType, note.noteType));
    const settings = this.repository.toSettingsView(this.repository.getSettingsRecord());
    if (!template) {
      throw new Error("Template not found.");
    }

    const emptySite = (siteNumber: 1 | 2): SiteSnapshot => ({
      siteNumber,
      bodyLocation: "",
      treatmentLocationText: "",
      diagnosisText: "",
      icd10: "",
      numberOfBlocks: 1,
      lesionSize: "",
      treatmentDepth: "3",
      coneSize: "",
      cutoutSize: "",
      shields: "",
      machine: "Xoft Elekta 1200 SPX",
      energyKv: "",
      treatmentInterval: "",
          additionalDevices: "",
          worksheetSide: "",
          worksheetPositioning: "",
          worksheetVacLokArea: "",
          worksheetEyeShieldType: "",
          worksheetGumShieldPosition: "",
          worksheetLipShieldPosition: "",
          dailyDose: 0,
          totalDose: 0,
        cumulativeDose: 0
      });

    const normalizedSites = applyAutoNumberOfBlocks(note.noteType, note.structuredFields.siteSnapshots);
    const site1 = normalizedSites.find((site) => site.siteNumber === 1) || emptySite(1);
    const site2 = normalizedSites.find((site) => site.siteNumber === 2) || emptySite(2);
    const projectedFractionsInput = note.structuredFields.projectedFractionsInput ?? null;
    const courseFractions = course.prescribedFractions > 0 ? course.prescribedFractions : null;
    const getTxSiteName = (site: typeof site1) => site.treatmentLocationText.trim() || site.bodyLocation.trim();
    const getTotalFractionValue = (site: typeof site1) =>
      site.prescribedFractions ?? (note.noteType === "consult_sim" ? projectedFractionsInput : null) ?? courseFractions;
    const getTotalFractions = (site: typeof site1) => {
      const fractions = getTotalFractionValue(site);
      return fractions && fractions > 0 ? fractions : "";
    };
    const getRenderableSite = (site: typeof site1) =>
      note.noteType === "consult_sim"
        ? applyAutomaticDoseValuesToSiteSnapshot(site, null, getTotalFractionValue(site))
        : site;
    const getCumulativeDose = (site: typeof site1) => {
      if (site.cumulativeDose > 0) {
        return site.cumulativeDose;
      }
      return note.noteType === "consult_sim" ? 0 : "";
    };
    const site1Base = getRenderableSite(site1);
    const site2Base = getRenderableSite(site2);
    const site1Render = {
      ...site1Base,
      biopsyDate: formatDisplayDate(site1Base.biopsyDate || note.structuredFields.biopsyDate),
      txSiteName: getTxSiteName(site1Base),
      dailyDose: site1Base.dailyDose > 0 ? site1Base.dailyDose : "",
      totalDose: site1Base.totalDose > 0 ? site1Base.totalDose : "",
      cumulativeDose: getCumulativeDose(site1Base),
      prescribedFractions: (site1Base.prescribedFractions ?? course.prescribedFractions) > 0 ? (site1Base.prescribedFractions ?? course.prescribedFractions) : "",
      totalFractions: getTotalFractions(site1Base),
      cutoutSize: normalizeCutoutSizeLabel(site1Base.cutoutSize),
      shields: buildShieldSummary(site1Base.shields, site1Base.additionalDevices),
      machine: getDefaultMachine(site1Base.machine),
      treatmentDepth: getDefaultTreatmentDepth(site1Base.treatmentDepth),
      coneSizeDisplay: formatMeasurement(site1Base.coneSize),
      cutoutSizeDisplay: formatMeasurement(site1Base.cutoutSize),
      flexShieldCutoutText: buildFlexShieldCutoutText(site1Base.cutoutSize, site1Base.coneSize),
      lesionSizeDisplay: formatMeasurement(site1Base.lesionSize),
      treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site1Base.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site1Base.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site1Base.additionalDevices),
        additionalDevices: formatAdditionalDevicesForSite(site1Base)
    };
    const site2Render = {
      ...site2Base,
      biopsyDate: formatDisplayDate(site2Base.biopsyDate || note.structuredFields.biopsyDate),
      txSiteName: getTxSiteName(site2Base),
      dailyDose: site2Base.dailyDose > 0 ? site2Base.dailyDose : "",
      totalDose: site2Base.totalDose > 0 ? site2Base.totalDose : "",
      cumulativeDose: getCumulativeDose(site2Base),
      prescribedFractions: (site2Base.prescribedFractions ?? course.prescribedFractions) > 0 ? (site2Base.prescribedFractions ?? course.prescribedFractions) : "",
      totalFractions: getTotalFractions(site2Base),
      cutoutSize: normalizeCutoutSizeLabel(site2Base.cutoutSize),
      shields: buildShieldSummary(site2Base.shields, site2Base.additionalDevices),
      machine: getDefaultMachine(site2Base.machine),
      treatmentDepth: getDefaultTreatmentDepth(site2Base.treatmentDepth),
      coneSizeDisplay: formatMeasurement(site2Base.coneSize),
      cutoutSizeDisplay: formatMeasurement(site2Base.cutoutSize),
      flexShieldCutoutText: buildFlexShieldCutoutText(site2Base.cutoutSize, site2Base.coneSize),
      lesionSizeDisplay: formatMeasurement(site2Base.lesionSize),
      treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site2Base.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site2Base.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site2Base.additionalDevices),
        additionalDevices: formatAdditionalDevicesForSite(site2Base)
      };

    const finalTreatmentSection = buildFinalTreatmentSection(
      note.structuredFields.finalTreatment && isFinalTreatmentEligible(note.treatmentNumber, course.prescribedFractions),
      note.structuredFields.finalTreatmentNote
    );
    const mipsSection = buildMipsSection(note.structuredFields.addMips, note.structuredFields.mipsNote);

    const renderedText = renderTemplate(template.templateText, {
      patient: {
        fullName: `${patient.firstName} ${patient.lastName}`.trim(),
        mrn: patient.mrn,
        dob: formatDisplayDate(patient.dob),
        sex: patient.sex,
        sexLower: patient.sex ? patient.sex.toLowerCase() : "patient",
        age: calculateAgeAtDate(patient.dob, note.visitDate)
      },
      visit: {
        date: formatDisplayDate(note.visitDate),
        noteTypeLabel: note.noteType,
        treatmentNumber: note.treatmentNumber ?? "",
        therapistName: note.therapistName
      },
      course: {
        prescribedFractions: course.prescribedFractions > 0 ? course.prescribedFractions : ""
      },
      settings: {
        supervisingPhysician: settings.supervisingPhysician,
        dermatologyOfficeName: settings.dermatologyOfficeName
      },
      site1: site1Render,
      site2: site2Render,
      vitals: formatVitals(note.vitals),
      structured: {
        ...note.structuredFields,
        additionalNotesSection: buildAdditionalNotesSection(note.structuredFields.additionalNotes),
        finalTreatmentSection,
        mipsSection,
        startRadiationDate: formatDisplayDate(note.structuredFields.startRadiationDate),
        biopsyDate: formatDisplayDate(note.structuredFields.biopsyDate),
        lastTreatmentDate: formatDisplayDate(note.structuredFields.lastTreatmentDate)
      }
    });

    return stripExamVitalsSection(
      injectFinalTreatmentSection(
        injectMipsSection(
          injectPhysicsConsultationDetails(renderedText, note.structuredFields.physicsComment, [
            site1Render.bodyLocation,
            site2Render.bodyLocation
          ]),
          mipsSection
        ),
        finalTreatmentSection
      ),
      note.noteType,
      note.structuredFields.includeExamVitals
    );
  }

  private buildVisitPhotoBaseName(note: VisitInput) {
    const firstSite = note.structuredFields.siteSnapshots[0];
    const siteLabel = firstSite?.treatmentLocationText || firstSite?.bodyLocation || "treatment-site";
    return `${siteLabel} ${buildTreatmentLabel(note)}`.trim();
  }

  private buildVisitAttachmentBaseName(note: VisitInput) {
    const firstSite = note.structuredFields.siteSnapshots[0];
    const siteLabel = firstSite?.treatmentLocationText || firstSite?.bodyLocation || "attachment";
    return `${siteLabel} ${buildTreatmentLabel(note)} attachment`.trim();
  }

  private buildPdfBaseName(patient: PatientRecord, visit: VisitNoteRecord) {
    const patientName = `${patient.firstName} ${patient.lastName}`.trim() || patient.id;
    const treatmentLabel = visit.treatmentNumber === null ? "consult" : `tx${visit.treatmentNumber}`;
    return sanitizeNamePart(`${patientName} ${treatmentLabel} note`) || `visit-${visit.id}`;
  }

  private removeSupersededFinalizedVisits(currentVisit: VisitNoteRecord) {
    const duplicateVisits = this.repository
      .fetchVisitsByCourseIds([currentVisit.courseId])
      .filter((visit) =>
        visit.note.id !== currentVisit.id &&
        visit.note.noteType === currentVisit.noteType &&
        (visit.note.treatmentNumber ?? null) === (currentVisit.treatmentNumber ?? null) &&
        (
          visit.note.status === "finalized" ||
          Boolean(visit.note.pdfAsset) ||
          visit.pdfs.length > 0
        )
      );

    for (const duplicate of duplicateVisits) {
      this.deleteVisit(duplicate.note.id);
    }
  }

  private getPatientNoteLibraryRoot() {
    const libraryRoot = this.patientNoteLibraryRoot || path.join(this.repository.baseDir, "All Patient Notes");
    this.assetStore.ensureDirectory(path.join(libraryRoot, "Consult Notes"));
    this.assetStore.ensureDirectory(path.join(libraryRoot, "Treatment Notes"));
    return libraryRoot;
  }

  private getPdfCategoryFolder(noteType: VisitInput["noteType"]) {
    return noteType === "consult_sim" ? "Consult Notes" : "Treatment Notes";
  }

  private buildPatientFolderName(patient: PatientRecord) {
    const folderName = sanitizeFolderName(`${patient.lastName}, ${patient.firstName}`);
    return folderName || patient.id;
  }

  private getCurrentNoteLogoPath() {
    const settings = this.repository.toSettingsView(this.repository.getSettingsRecord());
    return this.resolveAssetPath(settings.dermatologyOfficeLogoAsset) || this.defaultNoteLogoPath;
  }

  private readPdfAssetInput(asset: AssetReference | null, assetLabel: string, fileName?: string) {
    const resolvedPath = this.requireAssetPath(asset, assetLabel);
    return {
      bytes: fs.readFileSync(resolvedPath),
      fileName: fileName || path.basename(resolvedPath)
    };
  }

  private readPdfOptionalPathInput(resolvedPath: string | null | undefined, assetLabel: string) {
    if (!resolvedPath) {
      return null;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Could not resolve ${assetLabel}.`);
    }

    return {
      bytes: fs.readFileSync(resolvedPath),
      fileName: path.basename(resolvedPath)
    };
  }

  private resolveAssetPath(asset: AssetReference | null) {
    return this.assetStore.resolveAssetPath(asset);
  }

  private requireAssetPath(asset: AssetReference | null, assetLabel: string) {
    const resolvedPath = this.resolveAssetPath(asset);
    if (!resolvedPath) {
      throw new Error(`Could not resolve ${assetLabel}.`);
    }
    return resolvedPath;
  }

  private getRecoveryStructuredStore() {
    return this.repository as RecoveryCapableStructuredDataStore;
  }

  private getWipeableAssetStore() {
    return this.assetStore as WipeCapableBinaryAssetStore;
  }

  private assertUnlocked() {
    if (this.isLocked) {
      throw new Error("App is locked.");
    }
  }
}
