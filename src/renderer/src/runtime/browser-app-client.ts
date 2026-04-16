import { readPatientArchiveFromBytes } from "../../../shared/archive-read";
import {
  ensureValidPin,
  generatePinSalt,
  generateRecoveryCode,
  hashPin,
  normalizeRecoveryCode,
  verifyPin
} from "../../../shared/pin-auth";
import type {
  ImportedPatientArchiveDescription,
  PatientArchiveExportResult,
  PatientArchiveIoHandle,
  PatientArchivePreparationWarning,
  PatientArchivePreflightResult,
  PatientArchiveReadResult,
  PatientArchiveRestoreResult
} from "../../../shared/archive";
import {
  applyAutoNumberOfBlocks,
  buildDefaultStructuredFields,
  buildSiteSnapshots,
  createEmptyVitals,
  formatVitals,
  getCurrentFraction,
  getAutoNumberOfBlocks,
  getNextTreatmentNumber,
  getSuggestedNoteType,
  getTemplateKey,
  normalizeCutoutSizeLabel
} from "../../../shared/note-rules";
import type { AppClient, ArchiveSnapshot, AssetReference, DashboardSnapshot, PatientRecord, SettingsPayload, VisitEditorState, VisitInput, VisitNoteRecord } from "../../../shared/types";
import {
  exportPatientArchiveFromBrowserStores,
  type BrowserArchiveExportPayload
} from "./browser-archive-export";
import { preflightBrowserArchiveRestore, restoreBrowserArchive } from "./browser-archive-restore";
import { buildVisitPreviewText } from "../helpers";
import { buildVisitPdf, type PdfBinaryAssetInput } from "../../../main/pdf";
import { validateTemplate } from "../../../shared/template-engine";
import { BrowserBinaryAssetStore } from "../storage/browser-binary-asset-store";
import { BrowserStructuredDataStore } from "../storage/browser-structured-data-store";
import brandLogo from "../assets/dermatherapy-note-logo.jpg";

export interface BrowserArchiveClientDependencies {
  exportPatientArchive?: (patientId: string) => Promise<BrowserArchiveExportPayload>;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * Planning stub for the future browser/PWA AppClient.
 *
 * This file is intentionally not wired into the renderer yet. Its purpose is to
 * make the full browser implementation surface explicit and reviewable before any
 * real browser runtime behavior is introduced.
 */
export class BrowserAppClient implements AppClient {
  private readonly archiveBlobByHandle = new WeakMap<PatientArchiveIoHandle, Blob>();
  private readonly structuredDataStore: BrowserStructuredDataStore;
  private readonly binaryAssetStore: BrowserBinaryAssetStore;
  private isLocked = false;
  private hasBootstrapped = false;

  constructor(private readonly archiveDependencies: BrowserArchiveClientDependencies = {}) {
    this.structuredDataStore = new BrowserStructuredDataStore();
    this.binaryAssetStore = new BrowserBinaryAssetStore();
  }

  private async persistRecoveryCode(code: string) {
    const structuredDataStore = await this.getStructuredDataStore();
    const salt = generatePinSalt();
    const hash = await hashPin(code, salt);
    structuredDataStore.updateRecoveryCode(hash, salt);
    await structuredDataStore.flush();
    return code;
  }

  private assertUnlocked() {
    if (this.isLocked) {
      throw new Error("App is locked.");
    }
  }

  private notImplemented(methodName: keyof AppClient): never {
    throw new Error(`BrowserAppClient.${String(methodName)} is not implemented yet.`);
  }

  private makeId(prefix: string) {
    return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  }

  private getDefaultMachine(value: string) {
    return value.trim() || "Xoft Elekta 1200 SPX";
  }

  private getDefaultTreatmentDepth(value: string) {
    return value.trim() || "3";
  }

  private buildVisitPhotoBaseName(note: VisitInput) {
    const firstSite = note.structuredFields.siteSnapshots[0];
    const siteLabel = firstSite?.treatmentLocationText || firstSite?.bodyLocation || "treatment-site";
    return `${siteLabel} ${this.buildTreatmentLabel(note)}`.trim();
  }

  private buildVisitAttachmentBaseName(note: VisitInput) {
    const firstSite = note.structuredFields.siteSnapshots[0];
    const siteLabel = firstSite?.treatmentLocationText || firstSite?.bodyLocation || "attachment";
    return `${siteLabel} ${this.buildTreatmentLabel(note)} attachment`.trim();
  }

  private buildTreatmentLabel(note: VisitInput) {
    if (note.treatmentNumber === null) {
      return "consult";
    }

    return `tx ${note.treatmentNumber}`;
  }

  private buildPdfBaseName(patient: PatientRecord, visit: VisitNoteRecord) {
    const patientName = `${patient.firstName} ${patient.lastName}`.trim() || patient.id;
    const treatmentLabel = visit.treatmentNumber === null ? "consult" : `tx${visit.treatmentNumber}`;
    return sanitizeNamePart(`${patientName} ${treatmentLabel} note`) || `visit-${visit.id}`;
  }

  private getParentDir(filePath: string) {
    const lastSlash = filePath.lastIndexOf("/");
    return lastSlash > 0 ? filePath.slice(0, lastSlash) : null;
  }

  private getStoredAssetPath(binaryAssetStore: BrowserBinaryAssetStore, asset: AssetReference | null) {
    return asset ? binaryAssetStore.getStoredPath(asset.assetId) : null;
  }

  private deleteStoredFiles(binaryAssetStore: BrowserBinaryAssetStore, filePaths: Array<string | null | undefined>) {
    const uniquePaths = [...new Set(filePaths.filter((filePath): filePath is string => Boolean(filePath)))];
    if (uniquePaths.length === 0) {
      return;
    }

    binaryAssetStore.deleteFiles(uniquePaths);
    for (const filePath of uniquePaths) {
      const parentDir = this.getParentDir(filePath);
      if (parentDir) {
        binaryAssetStore.cleanupEmptyDirectoryChain(parentDir, binaryAssetStore.rootDir);
      }
    }
  }

  private removeDirectory(binaryAssetStore: BrowserBinaryAssetStore, dirPath: string) {
    binaryAssetStore.removeDirectory(dirPath);
    binaryAssetStore.cleanupEmptyDirectoryChain(dirPath, binaryAssetStore.rootDir);
  }

  private async readBlobInput(blob: Blob, fileName?: string): Promise<PdfBinaryAssetInput> {
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      fileName,
      mimeType: blob.type || undefined
    };
  }

  private async readStoredAssetInput(asset: AssetReference | null, assetLabel: string, fileName?: string) {
    if (!asset) {
      throw new Error(`Could not resolve ${assetLabel}.`);
    }

    const binaryAssetStore = await this.getBinaryAssetStore();
    const blob = binaryAssetStore.getStoredBlob(asset.assetId);
    if (!blob) {
      throw new Error(`Could not resolve ${assetLabel}.`);
    }

    return this.readBlobInput(blob, fileName);
  }

  private async readPdfLogoInput() {
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const settingsRecord = structuredDataStore.getSettingsRecord();
    if (settingsRecord.dermatologyOfficeLogoPath) {
      const asset = binaryAssetStore.createAssetReference(settingsRecord.dermatologyOfficeLogoPath, "settings_logo");
      if (asset) {
        const logoBlob = binaryAssetStore.getStoredBlob(asset.assetId);
        if (logoBlob) {
          return this.readBlobInput(logoBlob);
        }
      }
    }

    const response = await fetch(brandLogo);
    if (!response.ok) {
      throw new Error("Could not resolve note logo.");
    }

    return this.readBlobInput(await response.blob(), "dermatherapy-note-logo.jpg");
  }

  private async bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
    const blob = new Blob([Uint8Array.from(bytes)], { type: mimeType });
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error ?? new Error("Could not encode generated PDF."));
      reader.readAsDataURL(blob);
    });
  }

  private async loadExistingVisit(visitId: string): Promise<VisitEditorState> {
    const structuredDataStore = await this.getStructuredDataStore();
    const visit = structuredDataStore.fetchVisit(visitId);
    if (!visit) {
      throw new Error("Visit not found.");
    }

    const patient = structuredDataStore.fetchPatient(visit.patientId);
    const course = structuredDataStore.fetchCourse(visit.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    return {
      patient,
      course,
      sites: structuredDataStore.fetchSites([course.id]),
      note: {
        id: visit.id,
        patientId: visit.patientId,
        courseId: visit.courseId,
        visitDate: visit.visitDate,
        noteType: visit.noteType,
        treatmentNumber: visit.treatmentNumber,
        status: visit.status,
        therapistName: visit.therapistName,
        vitals: visit.vitals,
        structuredFields: {
          ...visit.structuredFields,
          additionalNotes: visit.structuredFields.additionalNotes ?? "",
          prescribedFractionsInput:
            visit.structuredFields.prescribedFractionsInput ??
            (visit.noteType !== "consult_sim" && course.prescribedFractions > 0 ? course.prescribedFractions : null),
          projectedFractionsInput: visit.structuredFields.projectedFractionsInput ?? null,
          biopsyDate: visit.structuredFields.biopsyDate || course.startDate || "",
          lastTreatmentDate: visit.structuredFields.lastTreatmentDate ?? course.startDate ?? "",
          siteSnapshots: applyAutoNumberOfBlocks(
            visit.noteType,
            visit.structuredFields.siteSnapshots.map((site) => ({
              ...site,
              biopsyDate: site.biopsyDate || visit.structuredFields.biopsyDate || course.startDate || ""
            }))
          )
        },
        generatedText: visit.generatedText,
        editedText: visit.editedText,
        newPhotoUploads: [],
        newAttachmentUploads: []
      },
      existingPhotos: structuredDataStore.fetchVisitPhotos(visit.id),
      existingAttachments: structuredDataStore.fetchVisitAttachments(visit.id),
      generatedPdfs: structuredDataStore.fetchGeneratedPdfs(visit.id),
      templateKey: getTemplateKey(course.courseType, visit.noteType)
    };
  }

  private createArchiveHandle(fileName: string, blob: Blob): PatientArchiveIoHandle {
    const handle: PatientArchiveIoHandle = {
      kind: "desktop_path",
      fileName,
      path: ""
    };
    this.archiveBlobByHandle.set(handle, blob);
    return handle;
  }

  private async resolveArchiveBlob(handle: PatientArchiveIoHandle) {
    const blob = this.archiveBlobByHandle.get(handle);
    if (!blob) {
      throw new Error(`Browser archive handle ${handle.fileName} is not attached to an in-memory File/Blob.`);
    }
    return blob;
  }

  private async readArchiveResult(archive: PatientArchiveIoHandle) {
    const blob = await this.resolveArchiveBlob(archive);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return readPatientArchiveFromBytes(archive, bytes);
  }

  private async getStructuredDataStore() {
    await this.structuredDataStore.initialize();
    return this.structuredDataStore;
  }

  private async getBinaryAssetStore() {
    this.binaryAssetStore.initialize();
    await this.binaryAssetStore.ready();
    return this.binaryAssetStore;
  }

  private triggerDownload(fileName: string, blob: Blob) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    queueMicrotask(() => URL.revokeObjectURL(objectUrl));
  }

  private pickZipFile(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,application/zip";
      input.style.display = "none";

      let settled = false;
      const finish = (file: File | null) => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("focus", handleWindowFocus);
        input.remove();
        resolve(file);
      };

      const handleWindowFocus = () => {
        window.setTimeout(() => finish(input.files?.[0] ?? null), 0);
      };

      input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
      input.addEventListener("cancel", () => finish(null), { once: true });
      window.addEventListener("focus", handleWindowFocus, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  // fully-portable: bootstrap loads the initial app state for the shell.
  // Browser implementation will read boot state from browser-backed storage adapters.
  async bootstrap() {
    const structuredDataStore = await this.getStructuredDataStore();
    const settings = structuredDataStore.getSettingsRecord();
    const requiresPinSetup = !settings.pinHash;
    if (!this.hasBootstrapped) {
      this.isLocked = Boolean(settings.pinHash);
      this.hasBootstrapped = true;
    } else if (requiresPinSetup) {
      this.isLocked = false;
    }

    return {
      settings: {
        ...structuredDataStore.toSettingsView(settings),
        inactivityTimeoutMinutes: 5
      },
      requiresPinSetup,
      isLocked: this.isLocked
    };
  }

  // fully-portable: reportReady only records the first reachable screen.
  // Browser implementation will report shell readiness without Electron launch hooks.
  async reportReady(_screen: Parameters<AppClient["reportReady"]>[0]) {
    // Browser bootstrap does not need the desktop launch-status hook.
  }

  // fully-portable: unlock validates the local PIN and returns success/failure.
  // Browser implementation will validate against local browser-held security state.
  async unlock(pin: string) {
    const structuredDataStore = await this.getStructuredDataStore();
    const settings = structuredDataStore.getSettingsRecord();
    if (!settings.pinHash || !settings.pinSalt) {
      return false;
    }

    const matches = await verifyPin(pin, settings.pinSalt, settings.pinHash);
    this.isLocked = !matches;
    return matches;
  }

  // fully-portable: lock flips the app back into its locked state.
  // Browser implementation will clear in-memory unlocked state and return to lock UI.
  async lock() {
    this.isLocked = true;
  }

  // fully-portable: setInitialPin seeds the first local PIN.
  // Browser implementation will persist the hashed PIN in browser-local structured storage.
  async setInitialPin(pin: string) {
    ensureValidPin(pin);
    const structuredDataStore = await this.getStructuredDataStore();
    const settings = structuredDataStore.getSettingsRecord();
    if (settings.pinHash) {
      throw new Error("PIN already exists.");
    }

    const salt = generatePinSalt();
    const hash = await hashPin(pin, salt);
    structuredDataStore.updatePin(hash, salt);
    await structuredDataStore.flush();
    this.isLocked = false;
    return this.persistRecoveryCode(generateRecoveryCode());
  }

  // fully-portable: changePin updates the stored local PIN after validation.
  // Browser implementation will update the local hashed PIN in browser storage.
  async changePin(currentPin: string, nextPin: string) {
    const unlocked = await this.unlock(currentPin);
    if (!unlocked) {
      throw new Error("Current PIN is incorrect.");
    }

    ensureValidPin(nextPin);
    const structuredDataStore = await this.getStructuredDataStore();
    const salt = generatePinSalt();
    const hash = await hashPin(nextPin, salt);
    structuredDataStore.updatePin(hash, salt);
    await structuredDataStore.flush();
    this.isLocked = false;
  }

  async resetPinWithRecoveryCode(recoveryCode: string, nextPin: string) {
    ensureValidPin(nextPin);
    const structuredDataStore = await this.getStructuredDataStore();
    const settings = structuredDataStore.getSettingsRecord();
    if (!settings.recoveryCodeHash || !settings.recoveryCodeSalt) {
      throw new Error("Recovery code is not available for this browser install.");
    }

    const normalizedRecoveryCode = normalizeRecoveryCode(recoveryCode);
    const recoveryMatches = await verifyPin(
      normalizedRecoveryCode,
      settings.recoveryCodeSalt,
      settings.recoveryCodeHash
    );
    if (!recoveryMatches) {
      throw new Error("Recovery code is incorrect.");
    }

    const salt = generatePinSalt();
    const hash = await hashPin(nextPin, salt);
    structuredDataStore.updatePin(hash, salt);
    await structuredDataStore.flush();
    this.isLocked = false;
    return this.persistRecoveryCode(generateRecoveryCode());
  }

  async wipeAllLocalData() {
    await this.structuredDataStore.wipeAllData();
    await this.binaryAssetStore.wipeAllData();
    this.isLocked = false;
    this.hasBootstrapped = false;
  }

  // fully-portable: returns the active dashboard snapshot.
  // Browser implementation will assemble the same view model from browser-local data.
  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const activePatients = structuredDataStore.fetchPatients("status = ?", ["active"]);
    const activeCourses = structuredDataStore.fetchCourses("status = ?", ["active"]);
    const courseIds = activeCourses.map((course) => course.id);
    const courseSites = structuredDataStore.fetchSites(courseIds);
    const visits = structuredDataStore.fetchVisitsByCourseIds(courseIds);
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

    const patientIdsWithActiveCourse = new Set(activeCourses.map((course) => course.patientId));
    const allCourses = structuredDataStore.fetchCourses("1 = 1", []);
    const patientIdsWithAnyCourse = new Set(allCourses.map((course) => course.patientId));
    const patientsWithoutCourse = activePatients
      .filter((patient) => !patientIdsWithActiveCourse.has(patient.id) && !patientIdsWithAnyCourse.has(patient.id))
      .map((patient) => ({
        patientId: patient.id,
        patientName: `${patient.lastName}, ${patient.firstName}`,
        patientMrn: patient.mrn,
        patientDob: patient.dob,
        patientFacePhoto: patient.facePhoto
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
          const shouldStartWithConsult = !hasConsultVisit && course.prescribedFractions <= 0;
          const suggestedTreatmentNumber = shouldStartWithConsult ? null : getNextTreatmentNumber(visitsForCourse);
          const suggestedNoteType = shouldStartWithConsult
            ? "consult_sim"
            : getSuggestedNoteType(suggestedTreatmentNumber);

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
        .filter((course): course is DashboardSnapshot["activeCourses"][number] => Boolean(course)),
      patientsWithoutCourse,
      archivedPatients: structuredDataStore.fetchPatients("1 = 1", []).filter((patient) => patient.status !== "active").length,
      archivedCourses: structuredDataStore.fetchCourses("1 = 1", []).filter((course) => course.status !== "active").length
    };
  }

  // fully-portable: loads a full patient detail/history view model.
  // Browser implementation will read the same shape from browser-local data.
  async getPatientDetail(patientId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const detail = structuredDataStore.loadPatientDetails([patientId])[0];
    if (!detail) {
      throw new Error("Patient not found.");
    }
    return detail;
  }

  // fully-portable: lists completed patients and their history snapshot.
  // Browser implementation will query completed local records from browser storage.
  async listCompleted(): Promise<ArchiveSnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      patients: structuredDataStore.loadPatientDetails(structuredDataStore.fetchCompletedPatientIds())
    };
  }

  // fully-portable: lists archived patients/history.
  // Browser implementation will query archived local records from browser storage.
  async listArchive(): Promise<ArchiveSnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      patients: structuredDataStore.loadPatientDetails(structuredDataStore.fetchArchivePatientIds())
    };
  }

  // fully-portable: creates or updates a patient record.
  // Browser implementation will save patient data and any uploaded face photo locally.
  async savePatient(input: Parameters<AppClient["savePatient"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const patientInput = input.id ? input : { ...input, id: this.makeId("patient") };
    const patientId = patientInput.id!;
    const existing = structuredDataStore.fetchPatient(patientId);

    let facePhotoPath: string | null = null;
    if (patientInput.facePhotoUpload) {
      facePhotoPath = binaryAssetStore.saveUpload(
        patientInput.facePhotoUpload,
        binaryAssetStore.getPatientProfileDir(patientId),
        `face-${patientInput.lastName || patientId || "patient"}`
      );

      const previousFacePhotoPath = existing?.facePhoto
        ? binaryAssetStore.getStoredPath(existing.facePhoto.assetId)
        : null;
      if (previousFacePhotoPath && previousFacePhotoPath !== facePhotoPath) {
        binaryAssetStore.deleteFile(previousFacePhotoPath);
        binaryAssetStore.cleanupEmptyDirectoryChain(
          previousFacePhotoPath.slice(0, previousFacePhotoPath.lastIndexOf("/")),
          binaryAssetStore.rootDir
        );
      }
    }

    const patient = structuredDataStore.savePatient(patientInput, facePhotoPath);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return patient;
  }

  // fully-portable: marks a patient as archived in local state.
  // Browser implementation will update the local patient status.
  async archivePatient(patientId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    structuredDataStore.setPatientStatus(patientId, "archived");
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: restores an archived patient to active/completed state.
  // Browser implementation will update the local patient status.
  async restorePatient(patientId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    structuredDataStore.setPatientStatus(patientId, "active");
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: removes a patient from active history while preserving current behavior rules.
  // Browser implementation will perform the same local delete/archive cleanup logic.
  async deletePatient(patientId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    structuredDataStore.setPatientStatus(patientId, "deleted");
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: permanently deletes a patient and related local records/assets.
  // Browser implementation will execute the same destructive local cleanup against browser storage.
  async permanentlyDeletePatient(patientId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const assetSet = structuredDataStore.getPatientAssetRecordSet(patientId);
    const facePhotoPath = this.getStoredAssetPath(binaryAssetStore, assetSet.patient?.facePhoto ?? null);
    const pdfPaths = assetSet.courses.flatMap((courseSet) =>
      courseSet.visits.flatMap((visitSet) =>
        visitSet.pdfs.map((pdf) => this.getStoredAssetPath(binaryAssetStore, pdf.fileAsset))
      )
    );
    const attachmentPaths = assetSet.courses.flatMap((courseSet) =>
      courseSet.visits.flatMap((visitSet) =>
        visitSet.attachments.map((attachment) => this.getStoredAssetPath(binaryAssetStore, attachment.fileAsset))
      )
    );
    const photoPaths = assetSet.courses.flatMap((courseSet) =>
      courseSet.visits.flatMap((visitSet) =>
        visitSet.photos.map((photo) => this.getStoredAssetPath(binaryAssetStore, photo.imageAsset))
      )
    );

    structuredDataStore.hardDeletePatientRecords(patientId);
    this.deleteStoredFiles(binaryAssetStore, [...pdfPaths, ...attachmentPaths, ...photoPaths, facePhotoPath]);
    this.removeDirectory(binaryAssetStore, `${binaryAssetStore.rootDir}/patients/${encodeURIComponent(patientId)}`);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // browser-alternative-needed: desktop uses a native file picker for archive ZIP selection.
  // Browser implementation will use an <input type="file"> or File System Access flow.
  async pickPatientArchive() {
    const file = await this.pickZipFile();
    if (!file) {
      return null;
    }

    return this.createArchiveHandle(file.name, file);
  }

  // browser-alternative-needed: desktop writes the archive ZIP to the filesystem.
  // Browser implementation will generate a ZIP blob and trigger browser download/share.
  async exportPatientArchive(patientId: string): Promise<PatientArchiveExportResult> {
    const payload = this.archiveDependencies.exportPatientArchive
      ? await this.archiveDependencies.exportPatientArchive(patientId)
      : await exportPatientArchiveFromBrowserStores(
          patientId,
          await this.getStructuredDataStore(),
          await this.getBinaryAssetStore()
        );
    const blobBytes = Uint8Array.from(payload.bytes);
    const blob = new Blob([blobBytes.buffer], { type: "application/zip" });
    const archiveHandle = this.createArchiveHandle(payload.fileName, blob);
    this.triggerDownload(payload.fileName, blob);

    return {
      patientId: payload.patientId,
      archiveHandle,
      includedAssetCount: payload.includedAssetCount,
      missingAssetCount: payload.missingAssetCount,
      warnings: payload.warnings
    };
  }

  // browser-alternative-needed: desktop preflight reads an archive handle from native disk.
  // Browser implementation will read and validate a picked File/Blob handle.
  async preflightPatientArchive(
    archive: Parameters<AppClient["preflightPatientArchive"]>[0]
  ): Promise<PatientArchivePreflightResult> {
    const readResult = await this.readArchiveResult(archive);
    const structuredDataStore = await this.getStructuredDataStore();
    return preflightBrowserArchiveRestore(structuredDataStore, readResult, archive);
  }

  // browser-alternative-needed: desktop reads archive contents from native disk.
  // Browser implementation will read the archive from browser-provided file/blob input.
  async readPatientArchive(archive: Parameters<AppClient["readPatientArchive"]>[0]) {
    return this.readArchiveResult(archive);
  }

  // browser-alternative-needed: desktop restores from a native archive handle.
  // Browser implementation will restore from a picked archive blob into browser-local storage.
  async restorePatientArchive(
    archive: Parameters<AppClient["restorePatientArchive"]>[0]
  ): Promise<PatientArchiveRestoreResult> {
    const blob = await this.resolveArchiveBlob(archive);
    const archiveBytes = new Uint8Array(await blob.arrayBuffer());
    const readResult = await this.readArchiveResult(archive);
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    return restoreBrowserArchive(structuredDataStore, binaryAssetStore, readResult, archive, archiveBytes);
  }

  // fully-portable: creates or updates a treatment course.
  // Browser implementation will persist the same course/site data locally.
  async saveCourse(input: Parameters<AppClient["saveCourse"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const normalizedInput = {
      ...input,
      sites: input.sites.map((site) => ({
        ...site,
        cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
        machine: this.getDefaultMachine(site.machine),
        treatmentDepth: this.getDefaultTreatmentDepth(site.treatmentDepth),
        numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", site.cutoutSize)
      }))
    };
    const course = structuredDataStore.saveCourse(normalizedInput);
    await structuredDataStore.flush();
    return course;
  }

  // fully-portable: marks a course completed.
  // Browser implementation will update local course status.
  async completeCourse(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    structuredDataStore.setCourseStatus(courseId, "completed", todayIso());
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: restores a completed course.
  // Browser implementation will update local course status.
  async restoreCourse(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    structuredDataStore.setCourseStatus(courseId, "active", null);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: deletes a course and related visit data under current product rules.
  // Browser implementation will perform equivalent local structured/asset cleanup.
  async deleteCourse(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const assetSet = structuredDataStore.getCourseAssetRecordSet(courseId);
    if (!assetSet) {
      return;
    }

    const patientId = assetSet.course.patientId;
    const pdfPaths = assetSet.visits.flatMap((visitSet) =>
      visitSet.pdfs.map((pdf) => this.getStoredAssetPath(binaryAssetStore, pdf.fileAsset))
    );
    const attachmentPaths = assetSet.visits.flatMap((visitSet) =>
      visitSet.attachments.map((attachment) => this.getStoredAssetPath(binaryAssetStore, attachment.fileAsset))
    );
    const photoPaths = assetSet.visits.flatMap((visitSet) =>
      visitSet.photos.map((photo) => this.getStoredAssetPath(binaryAssetStore, photo.imageAsset))
    );

    structuredDataStore.deleteCourseRecords(courseId);
    this.deleteStoredFiles(binaryAssetStore, [...pdfPaths, ...attachmentPaths, ...photoPaths]);
    this.removeDirectory(
      binaryAssetStore,
      `${binaryAssetStore.rootDir}/patients/${encodeURIComponent(patientId)}/courses/${encodeURIComponent(courseId)}`
    );
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: builds a visit draft/editor state from local business rules and history.
  // Browser implementation will reuse the same shared note logic against browser-local data.
  async buildVisitDraft(
    courseId: string,
    mode: Parameters<AppClient["buildVisitDraft"]>[1] = "next_treatment",
    existingVisitId?: string
  ) {
    this.assertUnlocked();
    if (existingVisitId) {
      return this.loadExistingVisit(existingVisitId);
    }

    const structuredDataStore = await this.getStructuredDataStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([courseId]);
    const visits = structuredDataStore.fetchVisitsByCourseIds([courseId]);
    const hasConsultVisit = visits.some((visit) => visit.note.noteType === "consult_sim");
    const shouldStartWithConsult = mode === "next_treatment" && !hasConsultVisit && course.prescribedFractions <= 0;
    const treatmentNumber = mode === "consult_sim" || shouldStartWithConsult ? null : getNextTreatmentNumber(visits);
    if (mode === "next_treatment" && treatmentNumber === null && !shouldStartWithConsult) {
      throw new Error("This course has reached the maximum treatment number.");
    }

    const noteType = mode === "consult_sim" || shouldStartWithConsult ? "consult_sim" : getSuggestedNoteType(treatmentNumber);
      const siteSnapshots = applyAutoNumberOfBlocks(noteType, buildSiteSnapshots(sites, treatmentNumber));
      const settings = structuredDataStore.getSettingsRecord();
      const latestConsultVisit = visits
        .filter((visit) => visit.note.noteType === "consult_sim")
        .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
      const projectedFractionsFromConsult = latestConsultVisit?.note.structuredFields.projectedFractionsInput ?? null;
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
      if (noteType !== "consult_sim") {
        if (treatmentNumber === 1 && projectedFractionsFromConsult && projectedFractionsFromConsult > 0) {
          structuredFields.prescribedFractionsInput = projectedFractionsFromConsult;
        } else if (course.prescribedFractions <= 0) {
          structuredFields.prescribedFractionsInput = course.prescribedFractions > 0 ? course.prescribedFractions : null;
        }
      }

    const note: VisitInput = {
      patientId: patient.id,
      courseId: course.id,
      visitDate: todayIso(),
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
    const templates = structuredDataStore.getTemplates();
    const generatedText = buildVisitPreviewText(patient ? templates : [], patient, course, note, structuredDataStore.toSettingsView(settings));
    note.generatedText = generatedText;
    note.editedText = generatedText;

    return {
      patient,
      course,
      sites,
      note,
      existingPhotos: [],
      existingAttachments: [],
      generatedPdfs: [],
      templateKey: getTemplateKey(course.courseType, note.noteType)
    } satisfies VisitEditorState;
  }

  // fully-portable: saves a visit note and associated structured fields.
  // Browser implementation will persist the visit and any uploads locally.
  async saveVisit(input: Parameters<AppClient["saveVisit"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const patient = structuredDataStore.fetchPatient(input.patientId);
    let course = structuredDataStore.fetchCourse(input.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    const prescribedFractionsInput =
      input.noteType !== "consult_sim" ? input.structuredFields.prescribedFractionsInput ?? null : null;
    if (prescribedFractionsInput && prescribedFractionsInput > 0 && prescribedFractionsInput !== course.prescribedFractions) {
      structuredDataStore.updateCoursePrescribedFractions(course.id, prescribedFractionsInput);
      course = structuredDataStore.fetchCourse(input.courseId);
      if (!course) {
        throw new Error("Visit context is incomplete.");
      }
    }

      const structuredFields = {
        ...input.structuredFields,
        additionalNotes: input.structuredFields.additionalNotes ?? "",
        prescribedFractionsInput: input.structuredFields.prescribedFractionsInput ?? null,
        projectedFractionsInput: input.structuredFields.projectedFractionsInput ?? null,
        biopsyDate: input.structuredFields.siteSnapshots[0]?.biopsyDate || input.structuredFields.biopsyDate || "",
        lastTreatmentDate: input.structuredFields.lastTreatmentDate ?? "",
      siteSnapshots: applyAutoNumberOfBlocks(
        input.noteType,
        input.structuredFields.siteSnapshots
          .map((snapshot) => ({
            ...snapshot,
            biopsyDate: snapshot.biopsyDate || input.structuredFields.biopsyDate || "",
            cumulativeDose: snapshot.dailyDose * (input.treatmentNumber ?? 0)
          }))
          .map((snapshot) => ({ ...snapshot, cutoutSize: normalizeCutoutSizeLabel(snapshot.cutoutSize) }))
      )
    };

    const normalizedInput: VisitInput = {
      ...input,
      therapistName: input.therapistName.trim(),
      vitals: formatVitals(input.vitals),
      structuredFields
    };

    const templates = structuredDataStore.getTemplates();
    const generatedText = buildVisitPreviewText(
      templates,
      patient,
      course,
      normalizedInput,
      structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord())
    );
    const editedText = normalizedInput.editedText.trim() || generatedText;
    const savedVisit = structuredDataStore.saveVisit(normalizedInput, generatedText, editedText);

    const existingPhotos = structuredDataStore.fetchVisitPhotos(savedVisit.id);
    const isConsultVisit = normalizedInput.noteType === "consult_sim";
    const seqBySite = new Map<number, number>();
    for (const p of existingPhotos) {
      const sn = p.siteNumber ?? 1;
      seqBySite.set(sn, (seqBySite.get(sn) ?? 0) + 1);
    }
    normalizedInput.newPhotoUploads.forEach((upload, index) => {
      const siteNumber: 1 | 2 = upload.siteNumber ?? 1;
      const site = normalizedInput.structuredFields.siteSnapshots.find((s) => s.siteNumber === siteNumber);
      const siteLabel = site?.treatmentLocationText || site?.bodyLocation || `Lesion ${siteNumber}`;
      const seq = (seqBySite.get(siteNumber) ?? 0) + 1;
      seqBySite.set(siteNumber, seq);
      const caption = isConsultVisit
        ? `${siteLabel} XRT Sim${seq}`
        : `${siteLabel} Tx${normalizedInput.treatmentNumber ?? ""}_${seq}`;
      const imageLabel = caption.toLowerCase().replace(/\s+/g, "-");
      const filePath = binaryAssetStore.saveUpload(
        upload,
        binaryAssetStore.getVisitPhotosDir(patient.id, course.id, savedVisit.id),
        imageLabel
      );
      structuredDataStore.addVisitPhoto(
        savedVisit.id,
        filePath,
        existingPhotos.length + index + 1,
        caption,
        siteNumber
      );
    });

    const existingAttachments = structuredDataStore.fetchVisitAttachments(savedVisit.id);
    const attachmentBaseName = this.buildVisitAttachmentBaseName(normalizedInput);
    normalizedInput.newAttachmentUploads.forEach((upload, index) => {
      const attachmentLabel =
        existingAttachments.length + index === 0
          ? attachmentBaseName
          : `${attachmentBaseName}-${existingAttachments.length + index + 1}`;
      const filePath = binaryAssetStore.saveUpload(
        upload,
        binaryAssetStore.getVisitAttachmentsDir(patient.id, course.id, savedVisit.id),
        attachmentLabel
      );
      structuredDataStore.addVisitAttachment(
        savedVisit.id,
        filePath,
        existingAttachments.length + index + 1,
        upload.caption?.trim() || upload.name,
        upload.mimeType,
        upload.name
      );
    });

    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return structuredDataStore.fetchVisit(savedVisit.id)!;
  }

  // fully-portable: deletes a visit and related local assets under current rules.
  // Browser implementation will perform equivalent local cleanup.
  async deleteVisit(visitId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const assetSet = structuredDataStore.getVisitAssetRecordSet(visitId);
    if (!assetSet) {
      return;
    }

    const { note } = assetSet;
    const pdfPaths = assetSet.pdfs.map((pdf) => this.getStoredAssetPath(binaryAssetStore, pdf.fileAsset));
    const attachmentPaths = assetSet.attachments.map((attachment) =>
      this.getStoredAssetPath(binaryAssetStore, attachment.fileAsset)
    );
    const photoPaths = assetSet.photos.map((photo) => this.getStoredAssetPath(binaryAssetStore, photo.imageAsset));

    structuredDataStore.deleteVisitRecords(visitId);
    this.deleteStoredFiles(binaryAssetStore, [...pdfPaths, ...attachmentPaths, ...photoPaths]);
    this.removeDirectory(
      binaryAssetStore,
      binaryAssetStore.getVisitWorkspaceDir(note.patientId, note.courseId, note.id)
    );
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // browser-alternative-needed: desktop generates a PDF and stores it as a local file asset.
  // Browser implementation will generate the same PDF bytes and store/download them with browser-safe asset handling.
  async generatePdf(visitId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const visit = structuredDataStore.fetchVisit(visitId);
    if (!visit) {
      throw new Error("Visit not found.");
    }

    const patient = structuredDataStore.fetchPatient(visit.patientId);
    const course = structuredDataStore.fetchCourse(visit.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    const photos = structuredDataStore.fetchVisitPhotos(visitId);
    const attachments = structuredDataStore.fetchVisitAttachments(visitId);
    const existingPdfs = structuredDataStore.fetchGeneratedPdfs(visitId);
    const versionNumber = existingPdfs.length + 1;
    const pdfBaseName = this.buildPdfBaseName(patient, visit);
    const pdfFileName = `${pdfBaseName}-v${versionNumber}.pdf`;

    const pdfBytes = await buildVisitPdf({
      noteText: visit.editedText || visit.generatedText,
      photoInputs: await Promise.all(
        photos.map(async (photo) => ({
          image: await this.readStoredAssetInput(photo.imageAsset, `visit photo ${photo.id}`),
          caption: photo.caption || `Treatment Photo ${photo.sortOrder}`,
          siteNumber: photo.siteNumber
        }))
      ),
      attachmentInputs: await Promise.all(
        attachments.map(async (attachment) => ({
          file: await this.readStoredAssetInput(attachment.fileAsset, `visit attachment ${attachment.id}`, attachment.originalName),
          caption: attachment.caption || attachment.originalName,
          mimeType: attachment.mimeType,
          originalName: attachment.originalName
        }))
      ),
      logoInput: await this.readPdfLogoInput()
    });

    const pdfUpload = {
      name: pdfFileName,
      mimeType: "application/pdf",
      dataUrl: await this.bytesToDataUrl(pdfBytes, "application/pdf")
    };
    const filePath = binaryAssetStore.saveUpload(
      pdfUpload,
      `${binaryAssetStore.getVisitWorkspaceDir(patient.id, course.id, visit.id)}/pdfs`,
      `${pdfBaseName}-v${versionNumber}`
    );
    structuredDataStore.insertGeneratedPdf(visitId, filePath, versionNumber);

    const downloadBlob = new Blob([Uint8Array.from(pdfBytes)], { type: "application/pdf" });
    this.triggerDownload(pdfFileName, downloadBlob);

    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    const persistedPdf = structuredDataStore.fetchGeneratedPdfs(visitId).find((pdf) => pdf.versionNumber === versionNumber);
    if (!persistedPdf) {
      throw new Error("Generated PDF record could not be reloaded after save.");
    }

    return {
      visitId,
      pdfAsset: persistedPdf.fileAsset,
      versionNumber
    };
  }

  async generateSimWorksheet(_visitId: string) {
    throw new Error("Sim worksheet generation is only available in the desktop app.");
  }

  // desktop-only-no-op: desktop returns a real local workspace folder path.
  // Browser implementation should use a virtual folder/download concept or a clear unsupported response.
  getVisitFolder(_visitId: string) {
    return this.notImplemented("getVisitFolder");
  }

  // fully-portable: removes a visit photo record and its local asset.
  // Browser implementation will remove the same photo from browser-local storage.
  async removeVisitPhoto(photoId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const photo = structuredDataStore.fetchVisitPhoto(photoId);
    if (!photo) {
      return;
    }

    const photoPath = this.getStoredAssetPath(binaryAssetStore, photo.imageAsset);
    structuredDataStore.deleteVisitPhotoRecord(photoId);
    this.deleteStoredFiles(binaryAssetStore, [photoPath]);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: removes a visit attachment record and its local asset.
  // Browser implementation will remove the same attachment from browser-local storage.
  async removeVisitAttachment(attachmentId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const attachment = structuredDataStore.fetchVisitAttachment(attachmentId);
    if (!attachment) {
      return;
    }

    const attachmentPath = this.getStoredAssetPath(binaryAssetStore, attachment.fileAsset);
    structuredDataStore.deleteVisitAttachmentRecord(attachmentId);
    this.deleteStoredFiles(binaryAssetStore, [attachmentPath]);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
  }

  // fully-portable: loads settings plus saved-option metadata.
  // Browser implementation will read the same payload from browser-local storage.
  async getSettingsPayload(): Promise<SettingsPayload> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      settings: {
        ...structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord()),
        inactivityTimeoutMinutes: 5
      },
      savedOptions: structuredDataStore.getSavedOptions()
    };
  }

  // fully-portable: saves settings including branding/logo metadata.
  // Browser implementation will persist settings and logo asset data locally in browser storage.
  async saveSettings(input: Parameters<AppClient["saveSettings"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const currentSettings = structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord());
    let logoPath = this.getStoredAssetPath(binaryAssetStore, currentSettings.dermatologyOfficeLogoAsset);

    if (input.removeDermatologyOfficeLogo) {
      this.deleteStoredFiles(binaryAssetStore, [logoPath]);
      logoPath = null;
    }

    if (input.dermatologyOfficeLogoUpload) {
      const nextLogoPath = binaryAssetStore.saveUpload(
        input.dermatologyOfficeLogoUpload,
        binaryAssetStore.getSettingsBrandingDir(),
        "dermatology-office-logo"
      );
      if (logoPath && logoPath !== nextLogoPath) {
        this.deleteStoredFiles(binaryAssetStore, [logoPath]);
      }
      logoPath = nextLogoPath;
    }

    structuredDataStore.updateSettings({
      ...input,
      inactivityTimeoutMinutes: 5,
      dermatologyOfficeLogoAsset: binaryAssetStore.createAssetReference(logoPath, "settings_logo"),
      dermatologyOfficeLogoPath: logoPath,
      dermatologyOfficeLogoUpload: undefined,
      removeDermatologyOfficeLogo: undefined
    });

    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return {
      ...structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord()),
      inactivityTimeoutMinutes: 5
    };
  }

  // fully-portable: removes a remembered option from local settings state.
  // Browser implementation will delete the same saved option from browser-local storage.
  async deleteSavedOption(optionId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    structuredDataStore.deleteSavedOption(optionId);
    await structuredDataStore.flush();
  }

  // fully-portable: lists editable note templates.
  // Browser implementation will read template records from browser-local structured storage.
  async getTemplates() {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return structuredDataStore.getTemplates();
  }

  // fully-portable: persists a template override.
  // Browser implementation will save the same template text locally.
  async saveTemplate(templateId: string, templateText: string) {
    this.assertUnlocked();
    const validation = validateTemplate(templateText);
    if (!validation.isValid) {
      throw new Error(`Unknown placeholders: ${validation.unknownTokens.join(", ")}`);
    }

    const structuredDataStore = await this.getStructuredDataStore();
    const template = structuredDataStore.saveTemplate(templateId, templateText);
    await structuredDataStore.flush();
    return template;
  }

  // fully-portable: resets a template back to its seeded default.
  // Browser implementation will restore the local default template text.
  async resetTemplate(templateId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const template = structuredDataStore.resetTemplate(templateId);
    await structuredDataStore.flush();
    return template;
  }

  // fully-portable: resolves an AssetReference to a displayable URL for the current runtime.
  // Browser implementation returns a blob: URL backed by the browser binary asset store.
  async resolveAssetUrl(asset: Parameters<AppClient["resolveAssetUrl"]>[0]) {
    const binaryAssetStore = await this.getBinaryAssetStore();
    return binaryAssetStore.resolveAssetUrl(asset);
  }

  // desktop-only-no-op: desktop reveals an asset in the native shell.
  // Browser implementation should no-op or offer a browser-safe alternative such as download/share.
  async revealAsset(_asset: Parameters<AppClient["revealAsset"]>[0]) {
    // Browser generatePdf already triggers a download, so reveal becomes a no-op.
  }

  // browser-alternative-needed: desktop opens an asset with the OS shell.
  // Browser implementation should open an object URL, download, or render inline when safe.
  async openAsset(asset: Parameters<AppClient["openAsset"]>[0]) {
    const assetUrl = await this.resolveAssetUrl(asset);
    if (!assetUrl) {
      throw new Error("Could not resolve asset.");
    }

    window.open(assetUrl, "_blank", "noopener,noreferrer");
  }

  // desktop-only-no-op: desktop reveals an arbitrary local path in the OS shell.
  // Browser implementation should no-op because arbitrary local path reveal has no browser equivalent.
  revealPath(_targetPath: string) {
    return this.notImplemented("revealPath");
  }

  // browser-alternative-needed: desktop opens an arbitrary local path with the OS shell.
  // Browser implementation should replace this with a browser-safe open/download flow when applicable.
  openPath(_targetPath: string) {
    return this.notImplemented("openPath");
  }
}
