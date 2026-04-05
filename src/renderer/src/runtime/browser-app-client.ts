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
  getCurrentFraction,
  getNextTreatmentNumber,
  getSuggestedNoteType,
  getTemplateKey
} from "../../../shared/note-rules";
import type { AppClient, ArchiveSnapshot, DashboardSnapshot, SettingsPayload } from "../../../shared/types";
import {
  exportPatientArchiveFromBrowserStores,
  type BrowserArchiveExportPayload
} from "./browser-archive-export";
import { preflightBrowserArchiveRestore, restoreBrowserArchive } from "./browser-archive-restore";
import { BrowserBinaryAssetStore } from "../storage/browser-binary-asset-store";
import { BrowserStructuredDataStore } from "../storage/browser-structured-data-store";

export interface BrowserArchiveClientDependencies {
  exportPatientArchive?: (patientId: string) => Promise<BrowserArchiveExportPayload>;
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
      settings: structuredDataStore.toSettingsView(settings),
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
            siteSummary: sitesForCourse.map((site) => site.bodyLocation).join(" + ")
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
  archivePatient(_patientId: string) {
    return this.notImplemented("archivePatient");
  }

  // fully-portable: restores an archived patient to active/completed state.
  // Browser implementation will update the local patient status.
  restorePatient(_patientId: string) {
    return this.notImplemented("restorePatient");
  }

  // fully-portable: removes a patient from active history while preserving current behavior rules.
  // Browser implementation will perform the same local delete/archive cleanup logic.
  deletePatient(_patientId: string) {
    return this.notImplemented("deletePatient");
  }

  // fully-portable: permanently deletes a patient and related local records/assets.
  // Browser implementation will execute the same destructive local cleanup against browser storage.
  permanentlyDeletePatient(_patientId: string) {
    return this.notImplemented("permanentlyDeletePatient");
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
  saveCourse(_input: Parameters<AppClient["saveCourse"]>[0]) {
    return this.notImplemented("saveCourse");
  }

  // fully-portable: marks a course completed.
  // Browser implementation will update local course status.
  completeCourse(_courseId: string) {
    return this.notImplemented("completeCourse");
  }

  // fully-portable: restores a completed course.
  // Browser implementation will update local course status.
  restoreCourse(_courseId: string) {
    return this.notImplemented("restoreCourse");
  }

  // fully-portable: deletes a course and related visit data under current product rules.
  // Browser implementation will perform equivalent local structured/asset cleanup.
  deleteCourse(_courseId: string) {
    return this.notImplemented("deleteCourse");
  }

  // fully-portable: builds a visit draft/editor state from local business rules and history.
  // Browser implementation will reuse the same shared note logic against browser-local data.
  buildVisitDraft(
    _courseId: string,
    _mode?: Parameters<AppClient["buildVisitDraft"]>[1],
    _existingVisitId?: string
  ) {
    return this.notImplemented("buildVisitDraft");
  }

  // fully-portable: saves a visit note and associated structured fields.
  // Browser implementation will persist the visit and any uploads locally.
  saveVisit(_input: Parameters<AppClient["saveVisit"]>[0]) {
    return this.notImplemented("saveVisit");
  }

  // fully-portable: deletes a visit and related local assets under current rules.
  // Browser implementation will perform equivalent local cleanup.
  deleteVisit(_visitId: string) {
    return this.notImplemented("deleteVisit");
  }

  // browser-alternative-needed: desktop generates a PDF and stores it as a local file asset.
  // Browser implementation will generate the same PDF bytes and store/download them with browser-safe asset handling.
  generatePdf(_visitId: string) {
    return this.notImplemented("generatePdf");
  }

  // desktop-only-no-op: desktop returns a real local workspace folder path.
  // Browser implementation should use a virtual folder/download concept or a clear unsupported response.
  getVisitFolder(_visitId: string) {
    return this.notImplemented("getVisitFolder");
  }

  // fully-portable: removes a visit photo record and its local asset.
  // Browser implementation will remove the same photo from browser-local storage.
  removeVisitPhoto(_photoId: string) {
    return this.notImplemented("removeVisitPhoto");
  }

  // fully-portable: removes a visit attachment record and its local asset.
  // Browser implementation will remove the same attachment from browser-local storage.
  removeVisitAttachment(_attachmentId: string) {
    return this.notImplemented("removeVisitAttachment");
  }

  // fully-portable: loads settings plus saved-option metadata.
  // Browser implementation will read the same payload from browser-local storage.
  async getSettingsPayload(): Promise<SettingsPayload> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      settings: structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord()),
      savedOptions: structuredDataStore.getSavedOptions()
    };
  }

  // fully-portable: saves settings including branding/logo metadata.
  // Browser implementation will persist settings and logo asset data locally in browser storage.
  saveSettings(_input: Parameters<AppClient["saveSettings"]>[0]) {
    return this.notImplemented("saveSettings");
  }

  // fully-portable: removes a remembered option from local settings state.
  // Browser implementation will delete the same saved option from browser-local storage.
  deleteSavedOption(_optionId: string) {
    return this.notImplemented("deleteSavedOption");
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
  saveTemplate(_templateId: string, _templateText: string) {
    return this.notImplemented("saveTemplate");
  }

  // fully-portable: resets a template back to its seeded default.
  // Browser implementation will restore the local default template text.
  resetTemplate(_templateId: string) {
    return this.notImplemented("resetTemplate");
  }

  // fully-portable: resolves an AssetReference to a displayable URL for the current runtime.
  // Browser implementation returns a blob: URL backed by the browser binary asset store.
  async resolveAssetUrl(asset: Parameters<AppClient["resolveAssetUrl"]>[0]) {
    const binaryAssetStore = await this.getBinaryAssetStore();
    return binaryAssetStore.resolveAssetUrl(asset);
  }

  // desktop-only-no-op: desktop reveals an asset in the native shell.
  // Browser implementation should no-op or offer a browser-safe alternative such as download/share.
  revealAsset(_asset: Parameters<AppClient["revealAsset"]>[0]) {
    return this.notImplemented("revealAsset");
  }

  // browser-alternative-needed: desktop opens an asset with the OS shell.
  // Browser implementation should open an object URL, download, or render inline when safe.
  openAsset(_asset: Parameters<AppClient["openAsset"]>[0]) {
    return this.notImplemented("openAsset");
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
