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
  applyAutomaticDoseValuesToSiteSnapshot,
  applyAutoNumberOfBlocks,
  buildDefaultStructuredFields,
  buildSiteSnapshots,
  createEmptyVitals,
  fillMissingSitePrescribedFractions,
  formatVitals,
  getCurrentFraction,
  getAutoNumberOfBlocks,
  getDefaultFinalTreatmentNote,
  getDefaultOtvNote,
  getDefaultPhysicsComment,
  getMaxSitePrescribedFractions,
  getNextTreatmentNumber,
  getSuggestedNoteType,
  getSitesForTreatmentNumber,
  getTemplateKey,
  getVisitTemplateKey,
  isTreatmentNoteType,
  isLegacyDefaultOtvNote,
  isFinalTreatmentEligible,
  normalizeVacLokAreaValue,
  normalizeOptionValue,
  refreshVisitSiteSnapshots,
  shouldIncludePhysicsNote,
  normalizeWorksheetDeviceDetailsForSite,
  normalizeVacLokPlacement,
  normalizeCutoutSizeLabel
} from "../../../shared/note-rules";
import type {
  AppClient,
  ArchiveSnapshot,
  AssetReference,
  CompletedLesionGenerationOptions,
  CompletedLesionIdPhotoSource,
  DashboardSnapshot,
  DocumentOnlySnapshot,
  PatientRecord,
  SettingsPayload,
  StoredAssetUpload,
  VisitDraftOptions,
  VisitEditorState,
  VisitInput,
  VisitNoteRecord
} from "../../../shared/types";
import {
  exportPatientArchiveFromBrowserStores,
  type BrowserArchiveExportPayload
} from "./browser-archive-export";
import { preflightBrowserArchiveRestore, restoreBrowserArchive } from "./browser-archive-restore";
import { buildVisitPreviewText } from "../helpers";
import { buildVisitPdf, type PdfBinaryAssetInput } from "../../../main/pdf";
import {
  buildConsentFormPdfFromTemplateBytes,
  buildConsentUploadPdf,
  buildSignedConsentFormPdfFromTemplateBytes
} from "../../../shared/consent-form-pdf";
import { buildConsultQuestionnairePdfFromTemplateBytes } from "../../../shared/consult-questionnaire-pdf";
import { buildSimWorksheetPdfFromTemplateBytes } from "../../../shared/sim-worksheet-pdf";
import { buildCompletedLesionFormPdf, type CompletedLesionPhotoInput } from "../../../shared/completed-lesion-form-pdf";
import { validateTemplate } from "../../../shared/template-engine";
import { buildDocumentOnlySyntheticContext } from "../../../shared/document-only";
import { BrowserBinaryAssetStore } from "../storage/browser-binary-asset-store";
import { BrowserStructuredDataStore } from "../storage/browser-structured-data-store";
import { checkBrowserRefreshUpdate } from "../refresh-pulse";
import consentFormTemplateUrl from "../../../../assets/templates/radiation-therapy-consent-form.pdf";
import consultQuestionnaireTemplateUrl from "../../../../assets/templates/radiation-therapy-consult-questionnaire.pdf";
import simWorksheetTemplateUrl from "../../../../assets/templates/radiation-therapy-sim-worksheet.pdf";

const COMPLETED_LESION_PHOTO_STAGES = ["sim_consult", "mid_treatment", "follow_up"] as const;

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

function ensureUniqueCourseSiteIds(sites: Parameters<AppClient["saveCourse"]>[0]["sites"]) {
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

function comparePatientNameParts(
  left: { firstName: string; lastName: string; mrn?: string },
  right: { firstName: string; lastName: string; mrn?: string }
) {
  return `${left.lastName}|${left.firstName}|${left.mrn ?? ""}`.localeCompare(
    `${right.lastName}|${right.firstName}|${right.mrn ?? ""}`,
    undefined,
    { sensitivity: "base", numeric: true }
  );
}

function compareDashboardPatientRows(
  left: { patientName: string; patientMrn: string; courseName?: string },
  right: { patientName: string; patientMrn: string; courseName?: string }
) {
  return `${left.patientName}|${left.patientMrn}|${left.courseName ?? ""}`.localeCompare(
    `${right.patientName}|${right.patientMrn}|${right.courseName ?? ""}`,
    undefined,
    { sensitivity: "base", numeric: true }
  );
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
  private consentFormTemplateBytesPromise: Promise<Uint8Array> | null = null;
  private consultQuestionnaireTemplateBytesPromise: Promise<Uint8Array> | null = null;
  private simWorksheetTemplateBytesPromise: Promise<Uint8Array> | null = null;
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
    if (note.noteType === "follow_up") {
      return "follow-up";
    }
    if (note.treatmentNumber === null) {
      return "consult";
    }

    return `tx ${note.treatmentNumber}`;
  }

  private buildPdfBaseName(patient: PatientRecord, visit: VisitNoteRecord) {
    const patientName = `${patient.firstName} ${patient.lastName}`.trim() || patient.id;
    const treatmentLabel = visit.noteType === "follow_up"
      ? "follow-up"
      : visit.treatmentNumber === null
        ? "consult"
        : `tx${visit.treatmentNumber}`;
    return sanitizeNamePart(`${patientName} ${treatmentLabel} note`) || `visit-${visit.id}`;
  }

  private getParentDir(filePath: string) {
    const lastSlash = filePath.lastIndexOf("/");
    return lastSlash > 0 ? filePath.slice(0, lastSlash) : null;
  }

  private getStoredAssetPath(binaryAssetStore: BrowserBinaryAssetStore, asset: AssetReference | null) {
    return asset ? binaryAssetStore.getStoredPath(asset.assetId) : null;
  }

  private getFileNameFromStoredPath(filePath: string | null) {
    if (!filePath) {
      return null;
    }

    const encodedName = filePath.slice(filePath.lastIndexOf("/") + 1);
    try {
      return decodeURIComponent(encodedName);
    } catch {
      return encodedName || null;
    }
  }

  private async getOpenFileName(asset: AssetReference, binaryAssetStore: BrowserBinaryAssetStore) {
    const structuredDataStore = await this.getStructuredDataStore();
    return (
      structuredDataStore.findOriginalNameForAsset(asset.assetId) ??
      this.getFileNameFromStoredPath(binaryAssetStore.getStoredPath(asset.assetId)) ??
      `${asset.assetId}.pdf`
    );
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

  private removeSupersededGeneratedPdfs(
    structuredDataStore: BrowserStructuredDataStore,
    binaryAssetStore: BrowserBinaryAssetStore,
    existingPdfs: Array<{ id: string; fileAsset: AssetReference }>,
    currentOutputPath: string
  ) {
    const oldPathsToDelete: string[] = [];

    for (const pdf of existingPdfs) {
      const storedPath = this.getStoredAssetPath(binaryAssetStore, pdf.fileAsset);
      if (storedPath && storedPath !== currentOutputPath) {
        oldPathsToDelete.push(storedPath);
      }
      structuredDataStore.deleteGeneratedPdfRecord(pdf.id);
    }

    this.deleteStoredFiles(binaryAssetStore, oldPathsToDelete);
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

  private async completedLesionPhotoInputFromUpload(
    upload: StoredAssetUpload,
    metadata?: Pick<CompletedLesionPhotoInput, "siteNumber" | "stage">
  ): Promise<CompletedLesionPhotoInput> {
    const response = await fetch(upload.dataUrl);
    return {
      ...metadata,
      image: await this.readBlobInput(await response.blob(), upload.name)
    };
  }

  private async completedLesionPhotoInputFromSource(source?: CompletedLesionIdPhotoSource | null, patient?: PatientRecord) {
    if (!source) {
      return null;
    }

    if (source.mode === "upload") {
      return this.completedLesionPhotoInputFromUpload(source.upload);
    }

    if (!patient?.facePhoto) {
      return null;
    }

    return {
      image: await this.readStoredAssetInput(patient.facePhoto, "patient face photo")
    };
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

    return null;
  }

  private async readSimWorksheetTemplateBytes() {
    if (!this.simWorksheetTemplateBytesPromise) {
      this.simWorksheetTemplateBytesPromise = (async () => {
        const response = await fetch(simWorksheetTemplateUrl);
        if (!response.ok) {
          throw new Error("Could not resolve sim worksheet template.");
        }

        return new Uint8Array(await response.arrayBuffer());
      })();
    }

    return this.simWorksheetTemplateBytesPromise;
  }

  private async readConsentFormTemplateBytes() {
    if (!this.consentFormTemplateBytesPromise) {
      this.consentFormTemplateBytesPromise = (async () => {
        const response = await fetch(consentFormTemplateUrl);
        if (!response.ok) {
          throw new Error("Could not resolve consent form template.");
        }

        return new Uint8Array(await response.arrayBuffer());
      })();
    }

    return this.consentFormTemplateBytesPromise;
  }

  private async readConsultQuestionnaireTemplateBytes() {
    if (!this.consultQuestionnaireTemplateBytesPromise) {
      this.consultQuestionnaireTemplateBytesPromise = (async () => {
        const response = await fetch(consultQuestionnaireTemplateUrl);
        if (!response.ok) {
          throw new Error("Could not resolve consult questionnaire template.");
        }

        return new Uint8Array(await response.arrayBuffer());
      })();
    }

    return this.consultQuestionnaireTemplateBytesPromise;
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

    const sites = structuredDataStore.fetchSites([course.id]);
    const courseDocuments = visit.noteType === "consult_sim" || visit.noteType === "follow_up"
      ? structuredDataStore.fetchCourseDocuments(course.id)
      : [];
    const scheduleDates = structuredDataStore.syncCourseScheduleDates(course.id);
    const refreshedSiteSnapshots = refreshVisitSiteSnapshots(
      visit.noteType,
      sites,
      visit.treatmentNumber,
      visit.structuredFields.siteSnapshots,
      visit.structuredFields.biopsyDate || course.startDate || ""
    );
    const resolvedSiteSnapshots = getSitesForTreatmentNumber(fillMissingSitePrescribedFractions(
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
    ), isTreatmentNoteType(visit.noteType) ? visit.treatmentNumber : null);
    const settings = structuredDataStore.getSettingsRecord();
    const finalTreatmentFraction =
      course.prescribedFractions > 0
        ? course.prescribedFractions
        : getMaxSitePrescribedFractions(resolvedSiteSnapshots);
    const finalTreatmentEligible =
      visit.noteType !== "consult_sim" &&
      isFinalTreatmentEligible(visit.treatmentNumber, finalTreatmentFraction);
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
        biopsyDate: visit.structuredFields.biopsyDate || course.startDate || "",
        lastTreatmentDate: visit.structuredFields.lastTreatmentDate ?? course.startDate ?? "",
        examComment:
          visit.noteType === "otv"
            ? !visit.structuredFields.examComment?.trim() || isLegacyDefaultOtvNote(visit.structuredFields.examComment)
              ? getDefaultOtvNote(resolvedSiteSnapshots, visit.treatmentNumber)
              : visit.structuredFields.examComment
            : visit.structuredFields.examComment ?? "",
        physicsComment:
          visit.structuredFields.physicsComment?.trim() ||
          (shouldIncludePhysicsNote(visit.noteType, visit.structuredFields.includePhysicsNote)
            ? getDefaultPhysicsComment("otv")
            : ""),
        includePhysicsNote: shouldIncludePhysicsNote(
          visit.noteType,
          visit.structuredFields.includePhysicsNote
        ),
        mipsNote: visit.structuredFields.mipsNote?.trim() || "",
        supervisedBy:
          visit.structuredFields.supervisedBy?.trim() || settings.supervisingPhysician,
        startRadiationDate:
          visit.noteType === "consult_sim"
            ? scheduleDates.treatmentStartDate ?? visit.structuredFields.startRadiationDate ?? ""
            : visit.structuredFields.startRadiationDate ?? "",
        siteSnapshots: resolvedSiteSnapshots
      },
      generatedText: visit.generatedText,
      editedText: visit.editedText,
      newPhotoUploads: [],
      newAttachmentUploads: []
    };
    const generatedText = buildVisitPreviewText(
      structuredDataStore.getTemplates(),
      patient,
      course,
      refreshedNote,
      structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord())
    );
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
      existingPhotos: structuredDataStore.fetchVisitPhotos(visit.id),
      existingAttachments: structuredDataStore.fetchVisitAttachments(visit.id),
      generatedPdfs: structuredDataStore.fetchGeneratedPdfs(visit.id),
      templateKey: getVisitTemplateKey(course.courseType, visit.noteType, refreshedNote.structuredFields.siteSnapshots)
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

  private triggerPdfDownload(fileName: string, bytes: Uint8Array) {
    this.triggerDownload(fileName, new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }));
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

  async checkForUpdates() {
    return checkBrowserRefreshUpdate();
  }

  async openUpdateDownload() {
    window.location.reload();
  }

  // fully-portable: returns the active dashboard snapshot.
  // Browser implementation will assemble the same view model from browser-local data.
  async getDashboardSnapshot(): Promise<DashboardSnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const activePatients = structuredDataStore.fetchPatients("status = ?", ["active"]);
    const activeCourses = structuredDataStore.fetchCourses("status = ?", ["active"]);
    const pendingCourses = structuredDataStore.fetchCourses("status = ?", ["pending"]);
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
      }))
      .sort(compareDashboardPatientRows);

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
        .filter((course): course is DashboardSnapshot["activeCourses"][number] => Boolean(course))
        .sort(compareDashboardPatientRows),
      pendingCourses: pendingCourses
        .map((course) => {
          const patient = patientMap.get(course.patientId);
          if (!patient) {
            return null;
          }

          const sitesForCourse = structuredDataStore.fetchSites([course.id]);
          const documentsForCourse = structuredDataStore.fetchCourseDocuments(course.id);
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
            hasConsentForm: documentsForCourse.some((document) => document.documentType === "consent_form"),
            hasConsultQuestionnaire: documentsForCourse.some((document) => document.documentType === "consult_questionnaire")
          };
        })
        .filter((course): course is DashboardSnapshot["pendingCourses"][number] => Boolean(course))
        .sort(compareDashboardPatientRows),
      patientsWithoutCourse,
      archivedPatients: structuredDataStore.fetchPatients("1 = 1", []).filter((patient) => patient.status !== "active").length,
      archivedCourses: structuredDataStore.fetchCourses("1 = 1", []).filter((course) => course.status !== "active").length
    };
  }

  async getScheduleSnapshot(startDate: string, endDate: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const dashboard = await this.getDashboardSnapshot();
    const pendingCourses = dashboard.pendingCourses.map((course) => ({
      ...course,
      currentFraction: 0,
      suggestedTreatmentNumber: 1,
      suggestedNoteType: "standard_treatment" as const,
      nextTemplateKey: getTemplateKey(course.courseType, "standard_treatment"),
      latestDraftVisitId: null,
      latestDraftUpdatedAt: null
    }));
    const completedCourses = structuredDataStore.fetchCourses("status = ?", ["completed"]);
    const completedPatients = new Map(
      structuredDataStore.fetchPatients("1 = 1", []).map((patient) => [patient.id, patient])
    );
    const completedCourseRows = completedCourses
      .map((course) => {
        const patient = completedPatients.get(course.patientId);
        if (!patient) return null;
        const visits = structuredDataStore.fetchVisitsByCourseIds([course.id]);
        const latestFollowUpDraft = visits
          .filter((visit) => visit.note.noteType === "follow_up" && visit.note.status === "draft")
          .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
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
          currentFraction: getCurrentFraction(visits),
          suggestedTreatmentNumber: null,
          suggestedNoteType: "follow_up" as const,
          nextTemplateKey: getTemplateKey(course.courseType, "follow_up"),
          siteSummary: structuredDataStore.fetchSites([course.id]).map((site) => site.bodyLocation).join(" + "),
          latestDraftVisitId: latestFollowUpDraft?.note.id ?? null,
          latestDraftUpdatedAt: latestFollowUpDraft?.note.updatedAt ?? null
        };
      })
      .filter((course): course is DashboardSnapshot["activeCourses"][number] => Boolean(course));
    return {
      appointments: structuredDataStore.fetchScheduleAppointments(startDate, endDate),
      blocks: structuredDataStore.fetchScheduleBlocks(startDate, endDate),
      settings: structuredDataStore.getScheduleSettings(),
      activeCourses: [...pendingCourses, ...dashboard.activeCourses, ...completedCourseRows].sort(compareDashboardPatientRows)
    };
  }

  async saveScheduleAppointment(input: Parameters<AppClient["saveScheduleAppointment"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const saved = structuredDataStore.saveScheduleAppointment(input);
    if (saved.courseId) {
      structuredDataStore.syncCourseScheduleDates(saved.courseId);
    }
    await structuredDataStore.flush();
    return structuredDataStore.fetchScheduleAppointment(saved.id) ?? saved;
  }

  async deleteScheduleAppointment(appointmentId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const existing = structuredDataStore.fetchScheduleAppointment(appointmentId);
    structuredDataStore.deleteScheduleAppointment(appointmentId);
    if (existing?.courseId) {
      structuredDataStore.syncCourseScheduleDates(existing.courseId);
    }
    await structuredDataStore.flush();
  }

  async deleteCourseTreatmentSchedule(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const deletedCount = structuredDataStore.deleteCourseTreatmentSchedule(courseId);
    await structuredDataStore.flush();
    return deletedCount;
  }

  async updateScheduleAppointmentStatus(
    appointmentId: string,
    status: Parameters<AppClient["updateScheduleAppointmentStatus"]>[1]
  ) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const saved = structuredDataStore.updateScheduleAppointmentStatus(appointmentId, status);
    if (saved.courseId) {
      structuredDataStore.syncCourseScheduleDates(saved.courseId);
    }
    await structuredDataStore.flush();
    return structuredDataStore.fetchScheduleAppointment(saved.id) ?? saved;
  }

  async saveScheduleBlock(input: Parameters<AppClient["saveScheduleBlock"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const saved = structuredDataStore.saveScheduleBlock(input);
    await structuredDataStore.flush();
    return saved;
  }

  async deleteScheduleBlock(blockId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    structuredDataStore.deleteScheduleBlock(blockId);
    await structuredDataStore.flush();
  }

  async saveScheduleSettings(input: Parameters<AppClient["saveScheduleSettings"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const saved = structuredDataStore.saveScheduleSettings(input);
    await structuredDataStore.flush();
    return saved;
  }

  async completeScheduleAppointmentForVisit(visitId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const visit = structuredDataStore.fetchVisit(visitId);
    if (!visit || visit.status !== "finalized") {
      return null;
    }

    const target = structuredDataStore
      .fetchScheduleAppointments("1900-01-01", "2999-12-31")
      .filter((appointment) => appointment.status !== "completed")
      .filter((appointment) => {
        if (appointment.courseId && appointment.courseId !== visit.courseId) {
          return false;
        }
        if (appointment.patientId && appointment.patientId !== visit.patientId) {
          return false;
        }
        if (visit.noteType === "follow_up") {
          return appointment.appointmentType === "follow_up";
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
      })[0];

    if (!target) {
      return null;
    }

    const saved = structuredDataStore.updateScheduleAppointmentStatus(target.id, "completed");
    await structuredDataStore.flush();
    return saved;
  }

  async getDocumentOnlySnapshot(): Promise<DocumentOnlySnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      records: structuredDataStore.loadDocumentOnlyDetails()
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
      patients: structuredDataStore
        .loadPatientDetails(structuredDataStore.fetchCompletedPatientIds())
        .sort((left, right) => comparePatientNameParts(left.patient, right.patient))
    };
  }

  // fully-portable: lists archived patients/history.
  // Browser implementation will query archived local records from browser storage.
  async listArchive(): Promise<ArchiveSnapshot> {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    return {
      patients: structuredDataStore
        .loadPatientDetails(structuredDataStore.fetchArchivePatientIds())
        .sort((left, right) => comparePatientNameParts(left.patient, right.patient))
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
    const documentPaths = assetSet.courses.flatMap((courseSet) =>
      courseSet.documents.map((document) => this.getStoredAssetPath(binaryAssetStore, document.fileAsset))
    );

    structuredDataStore.hardDeletePatientRecords(patientId);
    this.deleteStoredFiles(binaryAssetStore, [...pdfPaths, ...attachmentPaths, ...photoPaths, ...documentPaths, facePhotoPath]);
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
            cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
            machine: this.getDefaultMachine(site.machine),
            treatmentDepth: this.getDefaultTreatmentDepth(site.treatmentDepth),
        numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", site.cutoutSize)
      }))
    };
    const course = structuredDataStore.saveCourse(normalizedInput);
    structuredDataStore.trimCourseTreatmentAppointments(course.id, course.prescribedFractions);
    await structuredDataStore.flush();
    return structuredDataStore.fetchCourse(course.id) ?? course;
  }

  async saveDocumentOnlyRecord(input: Parameters<AppClient["saveDocumentOnlyRecord"]>[0]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const normalizedInput = {
      ...input,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      mrn: input.mrn.trim(),
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
          cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
          machine: this.getDefaultMachine(site.machine),
          treatmentDepth: this.getDefaultTreatmentDepth(site.treatmentDepth),
          additionalDevices: normalizedPlacement.additionalDevices,
          worksheetPositioning: normalizedPlacement.worksheetPositioning,
          worksheetVacLokArea: normalizeVacLokAreaValue(site.worksheetVacLokArea),
          worksheetEyeShieldType: normalizedDetails.worksheetEyeShieldType,
          worksheetGumShieldPosition: normalizedDetails.worksheetGumShieldPosition,
          worksheetLipShieldPosition: normalizedDetails.worksheetLipShieldPosition,
          numberOfBlocks: getAutoNumberOfBlocks("consult_sim", site.cutoutSize)
        };
      })
    };
    const record = structuredDataStore.saveDocumentOnlyRecord(normalizedInput);
    await structuredDataStore.flush();
    return record;
  }

  async deleteDocumentOnlyRecord(recordId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      return;
    }

    const filePaths = detail.files.map((file) => this.getStoredAssetPath(binaryAssetStore, file.fileAsset));
    structuredDataStore.deleteDocumentOnlyRecord(recordId);
    this.deleteStoredFiles(binaryAssetStore, filePaths);
    this.removeDirectory(binaryAssetStore, `${binaryAssetStore.rootDir}/document-only/${encodeURIComponent(recordId)}`);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
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
    const documentPaths = assetSet.documents.map((document) =>
      this.getStoredAssetPath(binaryAssetStore, document.fileAsset)
    );

    structuredDataStore.deleteCourseRecords(courseId);
    this.deleteStoredFiles(binaryAssetStore, [...pdfPaths, ...attachmentPaths, ...photoPaths, ...documentPaths]);
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
    existingVisitId?: string,
    options: VisitDraftOptions = {}
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
    if (course.status === "pending") {
      throw new Error("Finish course setup before starting the sim / consult note.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([courseId]);
    const visits = structuredDataStore.fetchVisitsByCourseIds([courseId]);
    const hasConsultVisit = visits.some((visit) => visit.note.noteType === "consult_sim");
    const currentFraction = getCurrentFraction(visits);
    const scheduleDates = structuredDataStore.syncCourseScheduleDates(course.id);
    const hasPlannedConsult = Boolean(scheduleDates.simConsultDate || course.simConsultDate);
    const scheduledTreatmentNumber =
      mode === "next_treatment" && typeof options.treatmentNumber === "number" && options.treatmentNumber > 0
        ? Math.trunc(options.treatmentNumber)
        : null;
    const shouldStartWithConsult =
      scheduledTreatmentNumber === null &&
      mode === "next_treatment" &&
      !hasConsultVisit &&
      currentFraction === 0 &&
      (hasPlannedConsult || course.prescribedFractions <= 0);
    const treatmentNumber =
      mode === "consult_sim" || mode === "follow_up" || shouldStartWithConsult
        ? null
        : scheduledTreatmentNumber ?? getNextTreatmentNumber(visits);
    if (mode === "next_treatment" && treatmentNumber === null && !shouldStartWithConsult) {
      throw new Error("This course has reached the maximum treatment number.");
    }

    const noteType = mode === "follow_up"
      ? "follow_up"
      : mode === "consult_sim" || shouldStartWithConsult
        ? "consult_sim"
        : getSuggestedNoteType(treatmentNumber);
    const visitDate = options.visitDate || (noteType === "consult_sim"
      ? scheduleDates.simConsultDate || course.simConsultDate || todayIso()
      : todayIso());
    const existingSlotVisit = visits
      .filter((visit) => {
        if (noteType === "follow_up") {
          return visit.note.noteType === "follow_up" && visit.note.visitDate === visitDate;
        }
        if (noteType === "consult_sim") {
          return visit.note.noteType === "consult_sim";
        }
        return isTreatmentNoteType(visit.note.noteType) && visit.note.treatmentNumber === treatmentNumber;
      })
      .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
    if (existingSlotVisit) {
      return this.loadExistingVisit(existingSlotVisit.note.id);
    }
    const courseDocuments = noteType === "consult_sim" || noteType === "follow_up"
      ? structuredDataStore.fetchCourseDocuments(course.id)
      : [];
      let siteSnapshots = applyAutoNumberOfBlocks(noteType, buildSiteSnapshots(sites, treatmentNumber));
      const settings = structuredDataStore.getSettingsRecord();
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
      const mostRecentTreatmentDate =
        visits
          .filter((visit) => isTreatmentNoteType(visit.note.noteType))
          .map((visit) => visit.note.visitDate)
          .filter(Boolean)
          .sort()
          .at(-1) ?? course.endDate ?? mostRecentVisitDate;
    const structuredFields = buildDefaultStructuredFields(noteType, siteSnapshots, settings.supervisingPhysician, {
      biopsyDate: course.startDate,
      lastTreatmentDate: noteType === "follow_up" ? mostRecentTreatmentDate : mostRecentVisitDate
    });
    structuredFields.siteSnapshots = structuredFields.siteSnapshots.map((site) => ({
      ...site,
      biopsyDate: site.biopsyDate || course.startDate || "",
      prescribedFractions:
        site.prescribedFractions ?? (noteType !== "consult_sim" && course.prescribedFractions > 0
          ? course.prescribedFractions
          : undefined)
    }));
    if (noteType === "consult_sim" && scheduleDates.treatmentStartDate) {
      structuredFields.startRadiationDate = scheduleDates.treatmentStartDate;
    }
      if (isTreatmentNoteType(noteType)) {
        if (treatmentNumber === 1) {
          siteSnapshots = fillMissingSitePrescribedFractions(
            siteSnapshots.map((site) => {
              const projectedSite = projectedFractionsBySiteFromConsult.find(
                (snapshot) => snapshot.siteNumber === site.siteNumber
              );
              return {
                ...site,
                prescribedFractions: projectedSite?.prescribedFractions ?? site.prescribedFractions
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
            : getMaxSitePrescribedFractions(structuredFields.siteSnapshots) ??
              getMaxSitePrescribedFractions(projectedFractionsBySiteFromConsult) ??
              projectedFractionsFromConsult;
        structuredFields.finalTreatment = isFinalTreatmentEligible(treatmentNumber, finalTreatmentFraction);
        structuredFields.siteSnapshots = getSitesForTreatmentNumber(
          structuredFields.siteSnapshots,
          treatmentNumber
        );
        const activeSiteDefaults = buildDefaultStructuredFields(
          noteType,
          structuredFields.siteSnapshots,
          settings.supervisingPhysician,
          { biopsyDate: course.startDate, lastTreatmentDate: mostRecentVisitDate }
        );
        structuredFields.focusedExam = activeSiteDefaults.focusedExam;
        structuredFields.healingDescription = activeSiteDefaults.healingDescription;
        structuredFields.followUp = activeSiteDefaults.followUp;
        structuredFields.simulationComplications = activeSiteDefaults.simulationComplications;
      }
      if (noteType === "otv") {
        structuredFields.examComment = getDefaultOtvNote(structuredFields.siteSnapshots, treatmentNumber);
      }

      const note: VisitInput = {
        patientId: patient.id,
        courseId: course.id,
        visitDate,
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
      courseDocuments,
      note,
      existingPhotos: [],
      existingAttachments: [],
      generatedPdfs: [],
      templateKey: getVisitTemplateKey(course.courseType, note.noteType, note.structuredFields.siteSnapshots)
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

    const treatmentVisit = isTreatmentNoteType(input.noteType);
    const normalizedSiteSnapshots = (
      input.structuredFields.siteSnapshots.length === 1
        ? input.structuredFields.siteSnapshots.map((site) => ({
            ...site,
            prescribedFractions:
              input.noteType === "consult_sim"
                ? input.structuredFields.projectedFractionsInput ?? site.prescribedFractions ?? undefined
                : treatmentVisit
                  ? input.structuredFields.prescribedFractionsInput ??
                  site.prescribedFractions ??
                  (course.prescribedFractions > 0 ? course.prescribedFractions : undefined)
                  : site.prescribedFractions ?? (course.prescribedFractions > 0 ? course.prescribedFractions : undefined)
          }))
        : input.structuredFields.siteSnapshots
    ).map((site) =>
      input.noteType === "consult_sim"
        ? applyAutomaticDoseValuesToSiteSnapshot(
            { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
            null,
            site.prescribedFractions ?? input.structuredFields.projectedFractionsInput ?? null
          )
        : treatmentVisit
          ? applyAutomaticDoseValuesToSiteSnapshot(
            { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
            input.treatmentNumber,
            site.prescribedFractions ?? null
          )
          : { ...site, cumulativeDose: 0 }
    );

    const prescribedFractionsInput =
      treatmentVisit
        ? input.structuredFields.prescribedFractionsInput ??
          getMaxSitePrescribedFractions(normalizedSiteSnapshots)
        : null;
    const projectedFractionsInput =
      input.noteType === "consult_sim"
        ? input.structuredFields.projectedFractionsInput ??
          getMaxSitePrescribedFractions(normalizedSiteSnapshots)
        : input.structuredFields.projectedFractionsInput ?? null;

    let courseSites = structuredDataStore.fetchSites([course.id]);
    let courseUpdated = false;
    if (treatmentVisit && prescribedFractionsInput && prescribedFractionsInput > 0 && prescribedFractionsInput !== course.prescribedFractions) {
      structuredDataStore.updateCoursePrescribedFractions(course.id, prescribedFractionsInput);
      structuredDataStore.trimCourseTreatmentAppointments(course.id, prescribedFractionsInput);
      courseUpdated = true;
    }
    if (treatmentVisit) {
      for (const siteSnapshot of normalizedSiteSnapshots) {
        const sitePrescribedFractions = siteSnapshot.prescribedFractions ?? null;
        if (!(sitePrescribedFractions && sitePrescribedFractions > 0)) {
          continue;
        }

        const storedSite = courseSites.find((site) => site.siteNumber === siteSnapshot.siteNumber);
        if ((storedSite?.prescribedFractions ?? null) !== sitePrescribedFractions) {
          structuredDataStore.updateCourseSitePrescribedFractions(course.id, siteSnapshot.siteNumber, sitePrescribedFractions);
          courseUpdated = true;
        }
        if (
          (storedSite?.dailyDose ?? 0) !== siteSnapshot.dailyDose ||
          (storedSite?.totalDose ?? 0) !== siteSnapshot.totalDose
        ) {
          structuredDataStore.updateCourseSiteDoseValues(
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
      course = structuredDataStore.fetchCourse(input.courseId);
      if (!course) {
        throw new Error("Visit context is incomplete.");
      }
      courseSites = structuredDataStore.fetchSites([course.id]);
    }

    const settings = structuredDataStore.getSettingsRecord();
    const priorCourseVisits = structuredDataStore.fetchVisitsByCourseIds([input.courseId]);
    const latestConsultVisit = priorCourseVisits
      .filter((visit) => visit.note.noteType === "consult_sim")
      .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt))[0];
    const finalTreatmentFraction =
      course.prescribedFractions > 0
        ? course.prescribedFractions
        : getMaxSitePrescribedFractions(normalizedSiteSnapshots) ??
          input.structuredFields.prescribedFractionsInput ??
          input.structuredFields.projectedFractionsInput ??
          getMaxSitePrescribedFractions(latestConsultVisit?.note.structuredFields.siteSnapshots ?? []) ??
          latestConsultVisit?.note.structuredFields.projectedFractionsInput;
    const finalTreatmentEligible = treatmentVisit && isFinalTreatmentEligible(input.treatmentNumber, finalTreatmentFraction);
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
          ? !input.structuredFields.examComment?.trim() || isLegacyDefaultOtvNote(input.structuredFields.examComment)
            ? getDefaultOtvNote(normalizedSiteSnapshots, input.treatmentNumber)
            : input.structuredFields.examComment
          : input.structuredFields.examComment ?? "",
      physicsComment:
        input.structuredFields.physicsComment?.trim() ||
        (shouldIncludePhysicsNote(input.noteType, input.structuredFields.includePhysicsNote)
          ? getDefaultPhysicsComment("otv")
          : ""),
      includePhysicsNote: shouldIncludePhysicsNote(
        input.noteType,
        input.structuredFields.includePhysicsNote
      ),
      mipsNote: input.structuredFields.mipsNote?.trim() || "",
      supervisedBy:
        input.structuredFields.supervisedBy?.trim() || settings.supervisingPhysician,
      siteSnapshots: getSitesForTreatmentNumber(
        refreshVisitSiteSnapshots(
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
        ),
        treatmentVisit ? input.treatmentNumber : null
      )
    };
    const selectedSupervisingPhysician = structuredFields.supervisedBy.trim();
    if (selectedSupervisingPhysician && selectedSupervisingPhysician !== settings.supervisingPhysician) {
      structuredDataStore.updateSettings({
        appName: settings.appName,
        defaultTherapist: settings.defaultTherapist,
        supervisingPhysician: selectedSupervisingPhysician,
        dermatologyOfficeName: settings.dermatologyOfficeName,
        dermatologyOfficeLogoAsset: null,
        dermatologyOfficeLogoPath: settings.dermatologyOfficeLogoPath,
        inactivityTimeoutMinutes: settings.inactivityTimeoutMinutes
      });
    }

    const normalizedInput: VisitInput = {
      ...input,
      id: (() => {
        const slotVisits = priorCourseVisits
          .filter((visit) =>
            visit.note.courseId === input.courseId &&
            visit.note.noteType === input.noteType &&
            (input.noteType === "follow_up"
              ? visit.note.visitDate === input.visitDate
              : (visit.note.treatmentNumber ?? null) === (input.treatmentNumber ?? null))
          )
          .sort((left, right) => right.note.updatedAt.localeCompare(left.note.updatedAt));
        const targetSlotVisit = input.id
          ? slotVisits.find((visit) => visit.note.id === input.id) ?? slotVisits[0] ?? null
          : slotVisits[0] ?? null;
        return targetSlotVisit?.note.id ?? input.id;
      })(),
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
    const isFollowUpVisit = normalizedInput.noteType === "follow_up";
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
        : isFollowUpVisit
          ? `${siteLabel} Follow-up_${seq}`
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

    const duplicateSlotVisits = structuredDataStore
      .fetchVisitsByCourseIds([input.courseId])
      .filter((visit) =>
        visit.note.id !== savedVisit.id &&
        visit.note.courseId === input.courseId &&
        (savedVisit.noteType === "follow_up"
          ? visit.note.noteType === "follow_up" && visit.note.visitDate === savedVisit.visitDate
          : savedVisit.noteType === "consult_sim"
            ? visit.note.noteType === "consult_sim"
            : isTreatmentNoteType(visit.note.noteType) && visit.note.treatmentNumber === savedVisit.treatmentNumber)
      );

    for (const duplicate of duplicateSlotVisits) {
      await this.deleteVisit(duplicate.note.id);
    }

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
    const versionNumber = Math.max(0, ...existingPdfs.map((pdf) => pdf.versionNumber)) + 1;
    const pdfBaseName = this.buildPdfBaseName(patient, visit);
    const pdfFileName = `${pdfBaseName}.pdf`;

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
        [
          ...attachments.map((attachment) => ({
            asset: attachment.fileAsset,
            assetLabel: `visit attachment ${attachment.id}`,
            caption: attachment.caption || attachment.originalName,
            mimeType: attachment.mimeType,
            originalName: attachment.originalName
          }))
        ].map(async (attachment) => ({
          file: await this.readStoredAssetInput(attachment.asset, attachment.assetLabel, attachment.originalName),
          caption: attachment.caption,
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
      pdfBaseName
    );
    structuredDataStore.insertGeneratedPdf(visitId, filePath, versionNumber);
    this.removeSupersededGeneratedPdfs(structuredDataStore, binaryAssetStore, existingPdfs, filePath);

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

  async generateSimWorksheet(visitId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const visit = structuredDataStore.fetchVisit(visitId);
    if (!visit) {
      throw new Error("Visit not found.");
    }
    if (visit.noteType !== "consult_sim") {
      throw new Error("Sim worksheet is only available for Sim / Consult visits.");
    }

    const patient = structuredDataStore.fetchPatient(visit.patientId);
    const course = structuredDataStore.fetchCourse(visit.courseId);
    if (!patient || !course) {
      throw new Error("Visit context is incomplete.");
    }

    const currentCourseSites = structuredDataStore.fetchSites([course.id]);
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

    const worksheet = await buildSimWorksheetPdfFromTemplateBytes(await this.readSimWorksheetTemplateBytes(), {
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

    const existingWorksheetAttachments = structuredDataStore
      .fetchVisitsByCourseIds([course.id])
      .flatMap((courseVisit) => courseVisit.attachments)
      .filter((attachment) => attachment.originalName === worksheet.fileName);
    for (const attachment of existingWorksheetAttachments) {
      const attachmentPath = this.getStoredAssetPath(binaryAssetStore, attachment.fileAsset);
      structuredDataStore.deleteVisitAttachmentRecord(attachment.id);
      this.deleteStoredFiles(binaryAssetStore, [attachmentPath]);
    }

    const filePath = binaryAssetStore.saveUpload(
      {
        name: worksheet.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(worksheet.bytes, "application/pdf")
      },
      binaryAssetStore.getVisitAttachmentsDir(patient.id, course.id, visit.id),
      worksheet.caption
    );
    const nextSortOrder = structuredDataStore.fetchVisitAttachments(visit.id).length + 1;
    structuredDataStore.addVisitAttachment(
      visit.id,
      filePath,
      nextSortOrder,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );
    this.triggerPdfDownload(worksheet.fileName, worksheet.bytes);

    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    const created = structuredDataStore
      .fetchVisitAttachments(visit.id)
      .find((attachment) => attachment.originalName === worksheet.fileName);
    if (!created) {
      throw new Error("Sim worksheet attachment could not be reloaded after save.");
    }

    return created;
  }

  async generateDocumentOnlyConsent(recordId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "consent_form") ?? null;
    const consentForm = await buildConsentFormPdfFromTemplateBytes(await this.readConsentFormTemplateBytes(), {
      patient,
      course,
      sites
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consentForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consentForm.bytes, "application/pdf")
      },
      binaryAssetStore.getDocumentOnlyFilesDir(recordId),
      consentForm.caption
    );

    const persistedFile = structuredDataStore.upsertDocumentOnlyFile(
      recordId,
      "consent_form",
      filePath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingFile ? this.getStoredAssetPath(binaryAssetStore, existingFile.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consentForm.fileName, consentForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedFile;
  }

  async finalizeDocumentOnlyConsent(recordId: string, input: Parameters<AppClient["finalizeDocumentOnlyConsent"]>[1]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "consent_form") ?? null;
    const consentForm = await buildSignedConsentFormPdfFromTemplateBytes(await this.readConsentFormTemplateBytes(), {
      patient,
      course,
      sites,
      signing: input
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consentForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consentForm.bytes, "application/pdf")
      },
      binaryAssetStore.getDocumentOnlyFilesDir(recordId),
      consentForm.caption
    );

    const persistedFile = structuredDataStore.upsertDocumentOnlyFile(
      recordId,
      "consent_form",
      filePath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingFile ? this.getStoredAssetPath(binaryAssetStore, existingFile.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consentForm.fileName, consentForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedFile;
  }

  async generateDocumentOnlyConsultQuestionnaire(
    recordId: string,
    input: Parameters<AppClient["generateDocumentOnlyConsultQuestionnaire"]>[1]
  ) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "consult_questionnaire") ?? null;
    const consultQuestionnaire = await buildConsultQuestionnairePdfFromTemplateBytes(
      await this.readConsultQuestionnaireTemplateBytes(),
      {
        patient,
        course,
        sites,
        questionnaire: input
      }
    );

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consultQuestionnaire.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consultQuestionnaire.bytes, "application/pdf")
      },
      binaryAssetStore.getDocumentOnlyFilesDir(recordId),
      consultQuestionnaire.caption
    );

    const persistedFile = structuredDataStore.upsertDocumentOnlyFile(
      recordId,
      "consult_questionnaire",
      filePath,
      consultQuestionnaire.caption,
      "application/pdf",
      consultQuestionnaire.fileName
    );

    const previousPath = existingFile ? this.getStoredAssetPath(binaryAssetStore, existingFile.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consultQuestionnaire.fileName, consultQuestionnaire.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedFile;
  }

  async generateDocumentOnlySimWorksheet(recordId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, visit } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "sim_worksheet") ?? null;
    const worksheet = await buildSimWorksheetPdfFromTemplateBytes(await this.readSimWorksheetTemplateBytes(), {
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

    const filePath = binaryAssetStore.saveUpload(
      {
        name: worksheet.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(worksheet.bytes, "application/pdf")
      },
      binaryAssetStore.getDocumentOnlyFilesDir(recordId),
      worksheet.caption
    );

    const persistedFile = structuredDataStore.upsertDocumentOnlyFile(
      recordId,
      "sim_worksheet",
      filePath,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );

    const previousPath = existingFile ? this.getStoredAssetPath(binaryAssetStore, existingFile.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(worksheet.fileName, worksheet.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedFile;
  }

  async generateDocumentOnlyCompletedLesionForm(recordId: string, options?: CompletedLesionGenerationOptions | null) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const detail = structuredDataStore.loadDocumentOnlyDetails([recordId])[0];
    if (!detail) {
      throw new Error("Document record not found.");
    }

    const { patient, course, sites } = buildDocumentOnlySyntheticContext(detail);
    const existingFile = detail.files.find((file) => file.fileType === "completed_lesion_form") ?? null;
    const photoInputs = await Promise.all(
      (options?.photoUploads ?? []).map((photo) => this.completedLesionPhotoInputFromUpload(photo.upload, photo))
    );
    const completedForm = await buildCompletedLesionFormPdf({
      patient,
      course,
      sites,
      formInput: options?.formInput ?? null,
      idPhotoInput: await this.completedLesionPhotoInputFromSource(options?.idPhotoSource, patient),
      photoInputs
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: completedForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(completedForm.bytes, "application/pdf")
      },
      binaryAssetStore.getDocumentOnlyFilesDir(recordId),
      completedForm.caption
    );

    const persistedFile = structuredDataStore.upsertDocumentOnlyFile(
      recordId,
      "completed_lesion_form",
      filePath,
      completedForm.caption,
      "application/pdf",
      completedForm.fileName
    );

    const previousPath = existingFile ? this.getStoredAssetPath(binaryAssetStore, existingFile.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(completedForm.fileName, completedForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedFile;
  }

  async generateConsentForm(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([course.id]);
    const existingDocument = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const consentForm = await buildConsentFormPdfFromTemplateBytes(await this.readConsentFormTemplateBytes(), {
      patient,
      course,
      sites
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consentForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consentForm.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      consentForm.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "consent_form",
      filePath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consentForm.fileName, consentForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async generateCourseConsultQuestionnaire(
    courseId: string,
    input: Parameters<AppClient["generateCourseConsultQuestionnaire"]>[1]
  ) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([course.id]);
    const existingDocument = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consult_questionnaire") ?? null;
    const consultQuestionnaire = await buildConsultQuestionnairePdfFromTemplateBytes(
      await this.readConsultQuestionnaireTemplateBytes(),
      {
        patient,
        course,
        sites,
        questionnaire: input
      }
    );

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consultQuestionnaire.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consultQuestionnaire.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      consultQuestionnaire.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "consult_questionnaire",
      filePath,
      consultQuestionnaire.caption,
      "application/pdf",
      consultQuestionnaire.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consultQuestionnaire.fileName, consultQuestionnaire.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async generateCourseSimWorksheet(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const settings = structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord());
    const sites = structuredDataStore.fetchSites([course.id]);
    const existingDocument = structuredDataStore
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
    const worksheet = await buildSimWorksheetPdfFromTemplateBytes(await this.readSimWorksheetTemplateBytes(), {
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

    const filePath = binaryAssetStore.saveUpload(
      {
        name: worksheet.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(worksheet.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      worksheet.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "sim_worksheet",
      filePath,
      worksheet.caption,
      "application/pdf",
      worksheet.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(worksheet.fileName, worksheet.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async generateCourseCompletedLesionForm(courseId: string, options?: CompletedLesionGenerationOptions | null) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([course.id]);
    const existingDocument = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "completed_lesion_form") ?? null;
    const courseVisitBundles = structuredDataStore
      .fetchVisitsByCourseIds([course.id])
      .slice()
      .sort((left, right) => {
        const dateCompare = left.note.visitDate.localeCompare(right.note.visitDate);
        return dateCompare || left.note.createdAt.localeCompare(right.note.createdAt);
      });
    const photos: CompletedLesionPhotoInput[] = [];
    const photoCountBySite = new Map<number, number>();
    for (const bundle of courseVisitBundles) {
      for (const photo of bundle.photos.slice().sort((left, right) => left.sortOrder - right.sortOrder)) {
        const siteNumber = photo.siteNumber ?? sites[0]?.siteNumber ?? 1;
        const stageIndex = photoCountBySite.get(siteNumber) ?? 0;
        if (stageIndex >= COMPLETED_LESION_PHOTO_STAGES.length) {
          continue;
        }
        photos.push({
          siteNumber,
          stage: COMPLETED_LESION_PHOTO_STAGES[stageIndex],
          image: await this.readStoredAssetInput(photo.imageAsset, `visit photo ${photo.id}`)
        });
        photoCountBySite.set(siteNumber, stageIndex + 1);
      }
    }
    const selectedPhotos = await Promise.all(
      (options?.photoUploads ?? []).map((photo) => this.completedLesionPhotoInputFromUpload(photo.upload, photo))
    );

    const completedForm = await buildCompletedLesionFormPdf({
      patient,
      course,
      sites,
      formInput: options?.formInput ?? null,
      idPhotoInput: await this.completedLesionPhotoInputFromSource(options?.idPhotoSource, patient),
      photoInputs: [...photos, ...selectedPhotos]
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: completedForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(completedForm.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      completedForm.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "completed_lesion_form",
      filePath,
      completedForm.caption,
      "application/pdf",
      completedForm.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(completedForm.fileName, completedForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async finalizeConsentForm(courseId: string, input: Parameters<AppClient["finalizeConsentForm"]>[1]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const sites = structuredDataStore.fetchSites([course.id]);
    const existingDocument = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const consentForm = await buildSignedConsentFormPdfFromTemplateBytes(await this.readConsentFormTemplateBytes(), {
      patient,
      course,
      sites,
      signing: input
    });

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consentForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consentForm.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      consentForm.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "consent_form",
      filePath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consentForm.fileName, consentForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async uploadConsentForm(courseId: string, upload: Parameters<AppClient["uploadConsentForm"]>[1]) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const patient = structuredDataStore.fetchPatient(course.patientId);
    if (!patient) {
      throw new Error("Patient not found.");
    }

    const existingDocument = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((document) => document.documentType === "consent_form") ?? null;
    const consentForm = await buildConsentUploadPdf(upload, patient);

    const filePath = binaryAssetStore.saveUpload(
      {
        name: consentForm.fileName,
        mimeType: "application/pdf",
        dataUrl: await this.bytesToDataUrl(consentForm.bytes, "application/pdf")
      },
      binaryAssetStore.getCourseDocumentsDir(patient.id, course.id),
      consentForm.caption
    );

    const persistedDocument = structuredDataStore.upsertCourseDocument(
      course.id,
      "consent_form",
      filePath,
      consentForm.caption,
      "application/pdf",
      consentForm.fileName
    );

    const previousPath = existingDocument ? this.getStoredAssetPath(binaryAssetStore, existingDocument.fileAsset) : null;
    if (previousPath && previousPath !== filePath) {
      this.deleteStoredFiles(binaryAssetStore, [previousPath]);
    }

    this.triggerPdfDownload(consentForm.fileName, consentForm.bytes);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
    return persistedDocument;
  }

  async deleteConsentForm(courseId: string) {
    this.assertUnlocked();
    const structuredDataStore = await this.getStructuredDataStore();
    const binaryAssetStore = await this.getBinaryAssetStore();
    const course = structuredDataStore.fetchCourse(courseId);
    if (!course) {
      throw new Error("Course not found.");
    }

    const document = structuredDataStore
      .fetchCourseDocuments(course.id)
      .find((item) => item.documentType === "consent_form");
    if (!document) {
      return;
    }

    const documentPath = this.getStoredAssetPath(binaryAssetStore, document.fileAsset);
    structuredDataStore.deleteCourseDocumentRecord(document.id);
    this.deleteStoredFiles(binaryAssetStore, [documentPath]);
    await Promise.all([structuredDataStore.flush(), binaryAssetStore.flush()]);
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
    const attachmentName = `${attachment.originalName || ""} ${attachment.caption || ""}`.toLowerCase();
    if (attachmentName.includes("sim worksheet")) {
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
    const settings = {
      ...structuredDataStore.toSettingsView(structuredDataStore.getSettingsRecord()),
      inactivityTimeoutMinutes: 5
    };

    return {
      settings,
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

  async rememberSavedOption(
    type: Parameters<AppClient["rememberSavedOption"]>[0],
    value: string
  ) {
    this.assertUnlocked();
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const structuredDataStore = await this.getStructuredDataStore();
    structuredDataStore.rememberOption(type, trimmed, normalizeOptionValue(trimmed));
    await structuredDataStore.flush();
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
    const binaryAssetStore = await this.getBinaryAssetStore();
    const blob = binaryAssetStore.getStoredBlob(asset.assetId);
    const fileName = await this.getOpenFileName(asset, binaryAssetStore);
    const isPdf = blob && (blob.type.toLowerCase().includes("pdf") || fileName.toLowerCase().endsWith(".pdf"));
    if (blob && isPdf) {
      this.triggerDownload(fileName, blob);
      return;
    }

    const assetUrl = binaryAssetStore.resolveAssetUrl(asset);
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
