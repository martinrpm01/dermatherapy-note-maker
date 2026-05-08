import { useEffect, useRef, useState } from "react";

import { useResolvedAssetUrl } from "./asset-url";
import {
  createDefaultDocumentOnlyConsentSigningInput,
  createDocumentOnlyInputFromDetail,
  createEmptyDocumentOnlyInput,
  buildDocumentOnlySyntheticContext
} from "../../shared/document-only";
import {
  buildVisitPreviewText,
  createCourseFormFromDetail,
  createEmptyConsentCourseForm,
  createEmptyCourseForm,
  createEmptyPatientForm,
  fileToCompressedUpload,
  fileToUpload,
  renderImageFileToUpload,
  readFileAsDataUrl
} from "./helpers";
import {
  ArchiveScreen,
  CompletedScreen,
  DashboardScreen,
  DocumentOnlyScreen,
  InstallPromptBanner,
  LockScreen,
  LogoCropModal,
  PatientScreen,
  PinRecoveryScreen,
  RecoveryCodeScreen,
  SettingsScreen,
  WipeLocalDataScreen
} from "./screen-components";
import {
  ConsentSigningModal,
  CourseConsentModal,
  DocumentOnlyRecordModal,
  DocumentOnlyWorksheetModal,
  PatientModal,
  CourseModal,
  PendingCourseIntakeModal
} from "./modal-components";
import { VisitEditorScreen } from "./visit-editor-screen";
import { ScheduleScreen, printPatientSchedule } from "./schedule-screen";
import appBrandLogo from "./assets/clear-skin-app-logo.jpg";
import defaultNoteLogo from "./assets/clear-skin-note-logo.jpg";
import brandIcon from "./assets/dermatherapy-icon.png";
import type { PatientArchiveExportResult, PatientArchivePreflightResult, PatientArchiveRestoreResult } from "../../shared/archive";
import type {
  AppClient,
  ArchiveSnapshot,
  BootstrapPayload,
  ConsentSigningInput,
  CourseInput,
  DashboardSnapshot,
  DocumentOnlyInput,
  DocumentOnlySnapshot,
  LaunchReadyScreen,
  PatientRecord,
  PatientDetail,
  PatientInput,
  ScheduleAppointmentRecord,
  SettingsPayload,
  StoredAssetUpload,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitDraftOptions,
  VisitEditorState
} from "../../shared/types";

type Screen =
  | { name: "dashboard" }
  | { name: "patient"; patientId: string }
  | { name: "visit"; courseId: string; mode: "next_treatment" | "consult_sim"; existingVisitId?: string; visitDate?: string; treatmentNumber?: number | null }
  | { name: "completed" }
  | { name: "archive" }
  | { name: "documents" }
  | { name: "schedule"; courseId?: string }
  | { name: "settings" };

type CourseModalMode = "intake" | "full";

interface AppProps {
  appClient: AppClient | null;
  initialClientError?: string;
}

type BrowserRecoveryFlow = "auth" | "recover_pin" | "wipe_data";

type CourseConsentSigningState = {
  kind: "course";
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  input: ConsentSigningInput;
};

type DocumentOnlyConsentSigningState = {
  kind: "document-only";
  recordId: string;
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  input: ConsentSigningInput;
};

type CourseConsentActionsState = {
  patientId: string;
  courseId: string;
};

type RecoveryDraft =
  | {
      kind: "patient";
      key: string;
      label: string;
      savedAt: string;
      value: PatientInput;
    }
  | {
      kind: "course";
      key: string;
      label: string;
      savedAt: string;
      value: {
        courseForm: CourseInput;
        courseFormMode: CourseModalMode;
        courseCompletionNeedsFacePhoto: boolean;
      };
    }
  | {
      kind: "documentOnly";
      key: string;
      label: string;
      savedAt: string;
      value: DocumentOnlyInput;
    }
  | {
      kind: "documentOnlyWorksheet";
      key: string;
      label: string;
      savedAt: string;
      value: DocumentOnlyInput;
    }
  | {
      kind: "consentSigning";
      key: string;
      label: string;
      savedAt: string;
      value: CourseConsentSigningState | DocumentOnlyConsentSigningState;
    };

type LogoCropState = {
  target: "setup" | "settings";
  file: File;
  sourceDataUrl: string;
};

type InstallAwareNavigator = Navigator & {
  standalone?: boolean;
};

type RefreshPulse = {
  id: string;
  version: string;
  commit: string;
  generatedAt: string;
};

const DESKTOP_DOWNLOAD_URL =
  "https://github.com/martinrpm01/dermatherapy-note-maker/releases/latest/download/ClearSkin-Hub-Setup.exe";
const REFRESH_PULSE_URL = "/refresh-pulse.json";
const REFRESH_PULSE_CHECK_INTERVAL_MS = 60_000;
const CURRENT_REFRESH_PULSE: RefreshPulse =
  typeof __CLEARSKIN_REFRESH_PULSE__ === "undefined"
    ? { id: "desktop", version: "desktop", commit: "desktop", generatedAt: "" }
    : __CLEARSKIN_REFRESH_PULSE__;

function shouldShowInstallPrompt() {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;
  const isIosDevice =
    /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isSafari =
    /safari/i.test(userAgent) && !/crios|fxios|edgios|opios/i.test(userAgent);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as InstallAwareNavigator).standalone === true;

  let isDismissed = false;
  try {
    isDismissed = window.localStorage.getItem("install-prompt-dismissed") === "true";
  } catch {
    isDismissed = false;
  }

  return isIosDevice && isSafari && !isStandalone && !isDismissed;
}

function shouldShowDesktopDownloadPrompt() {
  if (typeof window === "undefined" || window.rtNoteApi) {
    return false;
  }

  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;
  const isAppleTouchDevice =
    /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  const isMobileBrowser = isAppleTouchDevice || /android|mobile/i.test(userAgent);

  return !isMobileBrowser;
}

function canCheckRefreshPulse() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function parseRefreshPulse(value: unknown): RefreshPulse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const pulse = value as Record<string, unknown>;
  return typeof pulse.id === "string" && pulse.id.trim()
    ? {
        id: pulse.id,
        version: typeof pulse.version === "string" ? pulse.version : "",
        commit: typeof pulse.commit === "string" ? pulse.commit : "",
        generatedAt: typeof pulse.generatedAt === "string" ? pulse.generatedAt : ""
      }
    : null;
}

const RECOVERY_DRAFT_PREFIX = "clearskin:recovery-draft:v1:";

function canUseRecoveryStorage() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function getPatientRecoveryKey(form: PatientInput) {
  return `${RECOVERY_DRAFT_PREFIX}patient:${form.id ?? "new"}`;
}

function getCourseRecoveryKey(form: CourseInput, mode: CourseModalMode) {
  return `${RECOVERY_DRAFT_PREFIX}course:${form.id ?? `new:${form.patientId}:${mode}`}`;
}

function getDocumentOnlyRecoveryKey(form: DocumentOnlyInput) {
  return `${RECOVERY_DRAFT_PREFIX}document-only:${form.id ?? "new"}`;
}

function getDocumentOnlyWorksheetRecoveryKey(form: DocumentOnlyInput) {
  return `${RECOVERY_DRAFT_PREFIX}document-only-worksheet:${form.id ?? "new"}`;
}

function getConsentSigningRecoveryKey(signing: CourseConsentSigningState | DocumentOnlyConsentSigningState) {
  return signing.kind === "course"
    ? `${RECOVERY_DRAFT_PREFIX}consent:course:${signing.course.id}`
    : `${RECOVERY_DRAFT_PREFIX}consent:document-only:${signing.recordId}`;
}

function stripLargePatientDraftFields(form: PatientInput): PatientInput {
  const { facePhotoUpload, ...draft } = form;
  return draft;
}

function hasPatientDraftContent(form: PatientInput) {
  return Boolean(
    form.id ||
    form.firstName.trim() ||
    form.lastName.trim() ||
    form.mrn.trim() ||
    form.dob.trim() ||
    form.sex?.trim() ||
    form.notes.trim()
  );
}

function hasCourseDraftContent(form: CourseInput) {
  return Boolean(
    form.id ||
    form.courseName.trim() ||
    form.prescribedFractions > 0 ||
    form.sites.some((site) =>
      Boolean(
        site.treatmentLocationText.trim() ||
        site.bodyLocation.trim() ||
        site.diagnosisText.trim() ||
        site.icd10.trim() ||
        site.lesionSize.trim() ||
        site.coneSize.trim() ||
        site.cutoutSize.trim() ||
        site.worksheetSide.trim() ||
        site.worksheetPositioning.trim() ||
        site.additionalDevices.trim() && site.additionalDevices.trim().toLowerCase() !== "none" ||
        (site.prescribedFractions ?? 0) > 0
      )
    )
  );
}

function hasDocumentOnlyDraftContent(form: DocumentOnlyInput) {
  return Boolean(
    form.id ||
    form.firstName.trim() ||
    form.lastName.trim() ||
    form.mrn.trim() ||
    form.dob.trim() ||
    form.sex.trim() ||
    form.sites.some((site) =>
      Boolean(
        site.treatmentLocationText.trim() ||
        site.bodyLocation.trim() ||
        site.diagnosisText.trim() ||
        site.icd10.trim() ||
        site.lesionSize.trim() ||
        site.coneSize.trim() ||
        site.cutoutSize.trim() ||
        site.worksheetSide.trim() ||
        site.worksheetPositioning.trim() ||
        site.additionalDevices.trim() && site.additionalDevices.trim().toLowerCase() !== "none" ||
        (site.projectedFractions ?? 0) > 0
      )
    )
  );
}

function saveRecoveryDraft(draft: RecoveryDraft) {
  if (!canUseRecoveryStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(draft.key, JSON.stringify(draft));
  } catch {
    // Best-effort safety net only.
  }
}

function clearRecoveryDraft(key: string) {
  if (!canUseRecoveryStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort safety net only.
  }
}

function listRecoveryDrafts() {
  if (!canUseRecoveryStorage()) {
    return [] as RecoveryDraft[];
  }

  const drafts: RecoveryDraft[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(RECOVERY_DRAFT_PREFIX)) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as RecoveryDraft;
      if (parsed?.key === key && parsed.savedAt && parsed.kind) {
        drafts.push(parsed);
      }
    }
  } catch {
    return [];
  }

  return drafts.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

function formatRecoveryDraftTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "earlier";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function buildAutosaveVisitInput(note: VisitEditorState["note"]) {
  return {
    ...note,
    newPhotoUploads: [],
    newAttachmentUploads: []
  };
}

async function pickConsentUploadFile() {
  return new Promise<StoredAssetUpload | null>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf,image/*";
    input.style.display = "none";

    let settled = false;
    const finish = (upload: StoredAssetUpload | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.remove();
      resolve(upload);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }

      void (async () => {
        try {
          const upload = file.type.startsWith("image/")
            ? await fileToCompressedUpload(file, 2400, undefined, "image/jpeg")
            : await fileToUpload(file);
          finish(upload);
        } catch (error) {
          input.remove();
          reject(error);
        }
      })();
    }, { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function toPatientFormInput(detail: PatientDetail["patient"]): PatientInput {
  return {
    id: detail.id,
    firstName: detail.firstName,
    lastName: detail.lastName,
    mrn: detail.mrn,
    dob: detail.dob,
    sex: detail.sex,
    notes: detail.notes
  };
}

function ensureTherapistCredentials(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return /RT\(T\)\s*$/i.test(normalized) ? normalized : `${normalized} RT(T)`;
}

function buildDefaultConsentSigningInput(
  patient: PatientRecord,
  course: TreatmentCourseRecord,
  defaultWitnessName: string
): ConsentSigningInput {
  const isFemale = patient.sex.trim().toLowerCase() === "female";
  const initials = `${patient.firstName.trim().charAt(0)}${patient.lastName.trim().charAt(0)}`.toUpperCase();
  return {
    signDate: course.simConsultDate || new Date().toISOString().slice(0, 10),
    patientInitials: isFemale ? initials : "",
    patientPrintedName: `${patient.firstName} ${patient.lastName}`.trim(),
    formerRadiationAcknowledged: false,
    medicalDevicesAcknowledged: false,
    patientSignatureDataUrl: "",
    witnessPrintedName: ensureTherapistCredentials(defaultWitnessName),
    witnessSignatureDataUrl: ""
  };
}

export default function App({ appClient, initialClientError = "" }: AppProps) {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [bootError, setBootError] = useState(initialClientError);

  function showToast(message: string) {
    setStatusMessage(message);
    setToastKey((k) => k + 1);
    window.setTimeout(() => setStatusMessage(""), 6500);
  }
  const [screen, setScreen] = useState<Screen>({ name: "dashboard" });
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [documentOnlySnapshot, setDocumentOnlySnapshot] = useState<DocumentOnlySnapshot | null>(null);
  const [patientDetail, setPatientDetail] = useState<PatientDetail | null>(null);
  const [completed, setCompleted] = useState<ArchiveSnapshot | null>(null);
  const [completedSearch, setCompletedSearch] = useState("");
  const [archive, setArchive] = useState<ArchiveSnapshot | null>(null);
  const [settingsPayload, setSettingsPayload] = useState<SettingsPayload | null>(null);
  const [setupSettings, setSetupSettings] = useState<BootstrapPayload["settings"] | null>(null);
  const [templates, setTemplates] = useState<TemplateDefinitionRecord[]>([]);
  const [visitEditor, setVisitEditor] = useState<VisitEditorState | null>(null);
  const [patientForm, setPatientForm] = useState<PatientInput | null>(null);
  const [courseForm, setCourseForm] = useState<CourseInput | null>(null);
  const [documentOnlyForm, setDocumentOnlyForm] = useState<DocumentOnlyInput | null>(null);
  const [documentOnlyWorksheetForm, setDocumentOnlyWorksheetForm] = useState<DocumentOnlyInput | null>(null);
  const [courseFormMode, setCourseFormMode] = useState<CourseModalMode>("full");
  const [courseCompletionFacePhotoUpload, setCourseCompletionFacePhotoUpload] = useState<StoredAssetUpload | null>(null);
  const [courseCompletionNeedsFacePhoto, setCourseCompletionNeedsFacePhoto] = useState(false);
  const [consentSigning, setConsentSigning] = useState<CourseConsentSigningState | DocumentOnlyConsentSigningState | null>(null);
  const [courseConsentActions, setCourseConsentActions] = useState<CourseConsentActionsState | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");
  const [textDirty, setTextDirty] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [documentOnlySearch, setDocumentOnlySearch] = useState("");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [unlockPin, setUnlockPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);
  const [browserRecoveryFlow, setBrowserRecoveryFlow] = useState<BrowserRecoveryFlow>("auth");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [recoveryNextPin, setRecoveryNextPin] = useState("");
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState("");
  const [wipeConfirmationText, setWipeConfirmationText] = useState("");
  const [showWipeOption, setShowWipeOption] = useState(false);
  const [changePin, setChangePin] = useState({ currentPin: "", nextPin: "", confirmPin: "" });
  const [statusMessage, setStatusMessage] = useState("");
  const [toastKey, setToastKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [archiveActionBusy, setArchiveActionBusy] = useState(false);
  const [archiveExportBusyPatientId, setArchiveExportBusyPatientId] = useState<string | null>(null);
  const [archiveExportResult, setArchiveExportResult] = useState<PatientArchiveExportResult | null>(null);
  const [archiveExportError, setArchiveExportError] = useState<string | null>(null);
  const [archivePreflightResult, setArchivePreflightResult] = useState<PatientArchivePreflightResult | null>(null);
  const [archiveRestoreResult, setArchiveRestoreResult] = useState<PatientArchiveRestoreResult | null>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [logoCropState, setLogoCropState] = useState<LogoCropState | null>(null);
  const [recoveryDraftPrompt, setRecoveryDraftPrompt] = useState<RecoveryDraft | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveSignatureRef = useRef("");

  function restoreRecoveryDraft(draft: RecoveryDraft) {
    if (draft.kind === "patient") {
      setPatientForm(draft.value);
    } else if (draft.kind === "course") {
      setScreen({ name: "patient", patientId: draft.value.courseForm.patientId });
      setCourseForm(draft.value.courseForm);
      setCourseFormMode(draft.value.courseFormMode);
      setCourseCompletionNeedsFacePhoto(draft.value.courseCompletionNeedsFacePhoto);
      setCourseCompletionFacePhotoUpload(null);
    } else if (draft.kind === "documentOnly") {
      setScreen({ name: "documents" });
      setDocumentOnlyForm(draft.value);
    } else if (draft.kind === "documentOnlyWorksheet") {
      setScreen({ name: "documents" });
      setDocumentOnlyWorksheetForm(draft.value);
    } else {
      if (draft.value.kind === "course") {
        setScreen({ name: "patient", patientId: draft.value.patient.id });
      } else {
        setScreen({ name: "documents" });
      }
      setConsentSigning(draft.value);
    }
    setRecoveryDraftPrompt(null);
    showToast("Unsaved edits restored.");
  }

  function discardRecoveryDraft(draft: RecoveryDraft) {
    clearRecoveryDraft(draft.key);
    setRecoveryDraftPrompt(null);
    showToast("Recovery draft discarded.");
  }

  function clearPatientRecoveryFor(form: PatientInput | null) {
    if (form) {
      clearRecoveryDraft(getPatientRecoveryKey(form));
    }
  }

  function clearCourseRecoveryFor(form: CourseInput | null, mode = courseFormMode) {
    if (form) {
      clearRecoveryDraft(getCourseRecoveryKey(form, mode));
    }
  }

  function clearDocumentOnlyRecoveryFor(form: DocumentOnlyInput | null) {
    if (form) {
      clearRecoveryDraft(getDocumentOnlyRecoveryKey(form));
    }
  }

  function clearDocumentOnlyWorksheetRecoveryFor(form: DocumentOnlyInput | null) {
    if (form) {
      clearRecoveryDraft(getDocumentOnlyWorksheetRecoveryKey(form));
    }
  }

  function clearConsentSigningRecoveryFor(signing: CourseConsentSigningState | DocumentOnlyConsentSigningState | null) {
    if (signing) {
      clearRecoveryDraft(getConsentSigningRecoveryKey(signing));
    }
  }

  async function startLogoCrop(file: File | undefined, target: LogoCropState["target"]) {
    if (!file) {
      return;
    }

    try {
      const sourceDataUrl = await readFileAsDataUrl(file);
      setLogoCropState({
        target,
        file,
        sourceDataUrl
      });
    } catch {
      showToast("Could not open that logo file.");
    }
  }

  async function applyLogoCrop(selection: {
    shape: "wide" | "square";
    outputWidth: number;
    outputHeight: number;
    imageX: number;
    imageY: number;
    imageWidth: number;
    imageHeight: number;
  }) {
    if (!logoCropState) {
      return;
    }

    const preferredMimeType = "image/png";

    try {
      const upload = await renderImageFileToUpload(
        logoCropState.file,
        {
          x: selection.imageX,
          y: selection.imageY,
          width: selection.imageWidth,
          height: selection.imageHeight
        },
        {
          width: selection.outputWidth,
          height: selection.outputHeight
        },
        undefined,
        preferredMimeType,
        {
          trimWhitespace: selection.shape === "square",
          backgroundColor: "#ffffff"
        }
      );

      if (logoCropState.target === "setup") {
        setSetupSettings((current) => current ? {
          ...current,
          dermatologyOfficeLogoUpload: upload,
          dermatologyOfficeLogoAsset: current.dermatologyOfficeLogoAsset,
          removeDermatologyOfficeLogo: false
        } : current);
      }

      if (logoCropState.target === "settings") {
        const nextPayload = settingsPayload ? {
          ...settingsPayload,
          settings: {
            ...settingsPayload.settings,
            dermatologyOfficeLogoUpload: upload,
            dermatologyOfficeLogoAsset: settingsPayload.settings.dermatologyOfficeLogoAsset,
            removeDermatologyOfficeLogo: false
          }
        } : null;

        if (nextPayload && appClient) {
          const savedSettings = await appClient.saveSettings(nextPayload.settings);
          setSettingsPayload((current) => current ? { ...current, settings: savedSettings } : current);
          setBoot((current) => current ? { ...current, settings: savedSettings } : current);
          showToast("Settings updated.");
        } else {
          setSettingsPayload((current) => current ? {
            ...current,
            settings: {
              ...current.settings,
              dermatologyOfficeLogoUpload: upload,
              dermatologyOfficeLogoAsset: current.settings.dermatologyOfficeLogoAsset,
              removeDermatologyOfficeLogo: false
            }
          } : current);
        }
      }

      setLogoCropState(null);
    } catch {
      showToast("Could not crop that logo.");
    }
  }
  const resolvedNoteLogoSrc = useResolvedAssetUrl(appClient, boot?.settings.dermatologyOfficeLogoAsset);
  const authGateActive = Boolean(pendingRecoveryCode) || browserRecoveryFlow !== "auth";

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    setShowInstallPrompt(shouldShowInstallPrompt());
  }, []);

  useEffect(() => {
    if (navigator.storage?.persist) void navigator.storage.persist();
  }, []);

  useEffect(() => {
    if (
      !boot ||
      boot.isLocked ||
      boot.requiresPinSetup ||
      authGateActive ||
      recoveryDraftPrompt ||
      patientForm ||
      courseForm ||
      documentOnlyForm ||
      documentOnlyWorksheetForm ||
      consentSigning
    ) {
      return;
    }

    const nextDraft = listRecoveryDrafts()[0] ?? null;
    if (nextDraft) {
      setRecoveryDraftPrompt(nextDraft);
    }
  }, [
    boot,
    authGateActive,
    recoveryDraftPrompt,
    patientForm,
    courseForm,
    documentOnlyForm,
    documentOnlyWorksheetForm,
    consentSigning
  ]);

  useEffect(() => {
    if (!patientForm) {
      return;
    }
    const key = getPatientRecoveryKey(patientForm);
    if (!hasPatientDraftContent(patientForm)) {
      clearRecoveryDraft(key);
      return;
    }
    saveRecoveryDraft({
      kind: "patient",
      key,
      label: patientForm.id
        ? `patient edits for ${`${patientForm.firstName} ${patientForm.lastName}`.trim() || "this patient"}`
        : "new patient information",
      savedAt: new Date().toISOString(),
      value: stripLargePatientDraftFields(patientForm)
    });
  }, [patientForm]);

  useEffect(() => {
    if (!courseForm) {
      return;
    }
    const key = getCourseRecoveryKey(courseForm, courseFormMode);
    if (!hasCourseDraftContent(courseForm)) {
      clearRecoveryDraft(key);
      return;
    }
    saveRecoveryDraft({
      kind: "course",
      key,
      label: courseForm.id
        ? `course edits for ${courseForm.courseName || "this course"}`
        : courseFormMode === "intake"
          ? "new consent/path intake"
          : "new treatment course",
      savedAt: new Date().toISOString(),
      value: {
        courseForm,
        courseFormMode,
        courseCompletionNeedsFacePhoto
      }
    });
  }, [courseForm, courseFormMode, courseCompletionNeedsFacePhoto]);

  useEffect(() => {
    if (!documentOnlyForm) {
      return;
    }
    const key = getDocumentOnlyRecoveryKey(documentOnlyForm);
    if (!hasDocumentOnlyDraftContent(documentOnlyForm)) {
      clearRecoveryDraft(key);
      return;
    }
    saveRecoveryDraft({
      kind: "documentOnly",
      key,
      label: documentOnlyForm.id
        ? `document-only edits for ${`${documentOnlyForm.firstName} ${documentOnlyForm.lastName}`.trim() || "this record"}`
        : "new document-only patient information",
      savedAt: new Date().toISOString(),
      value: documentOnlyForm
    });
  }, [documentOnlyForm]);

  useEffect(() => {
    if (!documentOnlyWorksheetForm) {
      return;
    }
    const key = getDocumentOnlyWorksheetRecoveryKey(documentOnlyWorksheetForm);
    saveRecoveryDraft({
      kind: "documentOnlyWorksheet",
      key,
      label: `sim worksheet setup for ${`${documentOnlyWorksheetForm.firstName} ${documentOnlyWorksheetForm.lastName}`.trim() || "this record"}`,
      savedAt: new Date().toISOString(),
      value: documentOnlyWorksheetForm
    });
  }, [documentOnlyWorksheetForm]);

  useEffect(() => {
    if (!consentSigning) {
      return;
    }
    const key = getConsentSigningRecoveryKey(consentSigning);
    saveRecoveryDraft({
      kind: "consentSigning",
      key,
      label: `consent signing for ${`${consentSigning.patient.firstName} ${consentSigning.patient.lastName}`.trim() || "this patient"}`,
      savedAt: new Date().toISOString(),
      value: consentSigning
    });
  }, [consentSigning]);

  useEffect(() => {
    if (!boot?.requiresPinSetup) {
      return;
    }
    setSetupSettings({
      ...boot.settings,
      inactivityTimeoutMinutes: 5,
      dermatologyOfficeLogoUpload: null,
      removeDermatologyOfficeLogo: false
    });
  }, [boot]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const initialController = navigator.serviceWorker.controller;
    const handleControllerChange = () => {
      if (initialController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
  }, []);

  useEffect(() => {
    if (!canCheckRefreshPulse() || updateReady) {
      return;
    }

    let cancelled = false;

    async function checkRefreshPulse() {
      try {
        const response = await fetch(`${REFRESH_PULSE_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const remotePulse = parseRefreshPulse(await response.json());
        if (!cancelled && remotePulse && remotePulse.id !== CURRENT_REFRESH_PULSE.id) {
          setUpdateReady(true);
        }
      } catch {
        // Best-effort refresh notice only; the app keeps working offline.
      }
    }

    const intervalId = window.setInterval(() => void checkRefreshPulse(), REFRESH_PULSE_CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkRefreshPulse();
      }
    };
    const handleFocus = () => void checkRefreshPulse();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    void checkRefreshPulse();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [updateReady]);

  useEffect(() => {
    if (!boot?.settings.appName) {
      return;
    }

    document.title = boot.settings.appName;
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.href = brandIcon;
  }, [boot]);

  useEffect(() => {
    if (!boot || !appClient || authGateActive) {
      return;
    }

    const screenName: LaunchReadyScreen = boot.requiresPinSetup
      ? "pin_setup"
      : boot.isLocked
        ? "unlock"
        : "dashboard";

    void appClient.reportReady(screenName);
  }, [boot, appClient, authGateActive]);

  useEffect(() => {
    if (!boot || boot.isLocked || boot.requiresPinSetup || authGateActive) {
      return;
    }
    void loadTemplates();
    void loadSettings();
    void loadDashboard();
    if (screen.name === "settings") void loadSettings();
    if (screen.name === "dashboard") void loadDashboard();
    if (screen.name === "completed") void loadCompleted();
    if (screen.name === "archive") void loadArchive();
    if (screen.name === "documents") void loadDocumentOnly();
    if (screen.name === "patient") void loadPatient(screen.patientId);
    if (screen.name === "visit") {
      void loadVisit(screen.courseId, screen.mode, screen.existingVisitId, {
        visitDate: screen.visitDate,
        treatmentNumber: screen.treatmentNumber
      });
    }
  }, [screen, boot, authGateActive]);

  useEffect(() => {
    if (!boot || boot.isLocked || boot.requiresPinSetup || authGateActive) {
      return;
    }

    const timeoutMs = Math.max(1, boot.settings.inactivityTimeoutMinutes) * 60_000;
    let timer = window.setTimeout(() => void lockApp(), timeoutMs);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void lockApp(), timeoutMs);
    };

    for (const eventName of ["pointerdown", "keydown", "mousemove", "touchstart"]) {
      window.addEventListener(eventName, reset);
    }

    return () => {
      window.clearTimeout(timer);
      for (const eventName of ["pointerdown", "keydown", "mousemove", "touchstart"]) {
        window.removeEventListener(eventName, reset);
      }
    };
  }, [boot, authGateActive]);

  async function loadBootstrap() {
    try {
      if (!appClient) {
        throw new Error(initialClientError || "The application client is unavailable.");
      }

      setBoot(await appClient.bootstrap());
      setBootError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown startup error.";
      console.error("Bootstrap failed", error);
      setBootError(message);
    }
  }

  async function loadDashboard() {
    if (!appClient) return;
    setDashboard(await appClient.getDashboardSnapshot());
  }

  async function loadDocumentOnly() {
    if (!appClient) return;
    setDocumentOnlySnapshot(await appClient.getDocumentOnlySnapshot());
  }

  async function loadPatient(patientId: string) {
    if (!appClient) return;
    setPatientDetail(await appClient.getPatientDetail(patientId));
  }

  async function loadCompleted() {
    if (!appClient) return;
    setCompleted(await appClient.listCompleted());
  }

  async function loadArchive() {
    if (!appClient) return;
    setArchive(await appClient.listArchive());
  }

  async function refreshWorkflowSnapshots() {
    await Promise.all([loadDashboard(), loadCompleted(), loadArchive()]);
  }

  async function loadSettings() {
    if (!appClient) return;
    setSettingsPayload(await appClient.getSettingsPayload());
  }

  async function loadTemplates() {
    if (!appClient) return;
    const loaded = await appClient.getTemplates();
    setTemplates(loaded);
    if (!selectedTemplateId && loaded[0]) {
      setSelectedTemplateId(loaded[0].id);
      setTemplateDraft(loaded[0].templateText);
    }
  }

  async function loadVisit(
    courseId: string,
    mode: "next_treatment" | "consult_sim",
    existingVisitId?: string,
    options?: VisitDraftOptions
  ) {
    if (!appClient) return;
    try {
      const editor = await appClient.buildVisitDraft(courseId, mode, existingVisitId, options);
      setVisitEditor(editor);
      setTextDirty(false);
      autosaveSignatureRef.current = JSON.stringify(buildAutosaveVisitInput(editor.note));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start that note.";
      showToast(message);
      setScreen({ name: "schedule" });
    }
  }

  async function lockApp() {
    if (!appClient) return;
    await appClient.lock();
    setBoot((current) => (current ? { ...current, isLocked: true } : current));
    setUnlockPin("");
  }

  async function handleUnlock() {
    if (!appClient) return;
    const success = await appClient.unlock(unlockPin);
    if (!success) {
      setStatusMessage("Incorrect PIN.");
      return;
    }
    setBoot(await appClient.bootstrap());
    setStatusMessage("");
  }

  async function handleSetupPin() {
    if (setupPin !== confirmPin) {
      setStatusMessage("PIN confirmation does not match.");
      return;
    }
    if (!appClient) return;
    if (!setupSettings) return;
    const recoveryCode = await appClient.setInitialPin(setupPin);
    const savedSettings = await appClient.saveSettings({
      ...setupSettings,
      inactivityTimeoutMinutes: 5
    });
    setPendingRecoveryCode(recoveryCode);
    setBoot((await appClient.bootstrap()));
    setSettingsPayload((current) => current ? { ...current, settings: savedSettings } : { settings: savedSettings, savedOptions: [] });
    setSetupPin("");
    setConfirmPin("");
    setStatusMessage("");
  }

  async function handleRecoveryReset() {
    if (recoveryNextPin !== recoveryConfirmPin) {
      setStatusMessage("PIN confirmation does not match.");
      return;
    }
    if (!appClient) return;

    try {
      const nextRecoveryCode = await appClient.resetPinWithRecoveryCode(recoveryCodeInput, recoveryNextPin);
      setRecoveryCodeInput("");
      setRecoveryNextPin("");
      setRecoveryConfirmPin("");
      setShowWipeOption(false);
      setBrowserRecoveryFlow("auth");
      setPendingRecoveryCode(nextRecoveryCode);
      setBoot(await appClient.bootstrap());
      setStatusMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recovery failed.";
      setStatusMessage(message);
      setShowWipeOption(message.toLowerCase().includes("recovery code is incorrect"));
    }
  }

  async function handleWipeAllData() {
    if (!appClient) return;
    await appClient.wipeAllLocalData();
    setPendingRecoveryCode(null);
    setBrowserRecoveryFlow("auth");
    setRecoveryCodeInput("");
    setRecoveryNextPin("");
    setRecoveryConfirmPin("");
    setWipeConfirmationText("");
    setShowWipeOption(false);
    setUnlockPin("");
    setSetupPin("");
    setConfirmPin("");
    setStatusMessage("");
    setBoot(await appClient.bootstrap());
  }

  function updateVisitEditor(
    updater: (current: VisitEditorState) => VisitEditorState,
    options: { regenerate?: boolean; overwriteEdited?: boolean } = {}
  ) {
    if (!visitEditor) {
      return;
    }
    const updated = updater(visitEditor);
    if (!options.regenerate) {
      setVisitEditor(updated);
      return;
    }

    const generatedText = buildVisitPreviewText(
      templates,
      updated.patient,
      updated.course,
      updated.note,
      settingsPayload?.settings
    );
    setVisitEditor({
      ...updated,
      note: {
        ...updated.note,
        generatedText,
        editedText: options.overwriteEdited ? generatedText : updated.note.editedText
      }
    });
  }

  useEffect(() => {
    if (!appClient || screen.name !== "visit" || !visitEditor) {
      return;
    }

    const autosaveInput = buildAutosaveVisitInput(visitEditor.note);
    const signature = JSON.stringify(autosaveInput);
    if (signature === autosaveSignatureRef.current) {
      return;
    }

    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const saved = await appClient.saveVisit(autosaveInput);
        autosaveSignatureRef.current = JSON.stringify({
          ...autosaveInput,
          id: saved.id,
          status: saved.status,
          generatedText: saved.generatedText,
          editedText: autosaveInput.editedText
        });
        setVisitEditor((current) => {
          if (!current || current.course.id !== saved.courseId) {
            return current;
          }

          return {
            ...current,
            note: {
              ...current.note,
              id: saved.id,
              status: saved.status
            }
          };
        });
        await loadDashboard();
      })();
    }, 800);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [appClient, screen, visitEditor]);

  async function savePatientForm() {
    if (!patientForm) return;
    setBusy(true);
    try {
      if (!appClient) return;
      const patient = await appClient.savePatient(patientForm);
      clearPatientRecoveryFor(patientForm);
      setPatientForm(null);
      setScreen({ name: "patient", patientId: patient.id });
      await loadDashboard();
      await loadPatient(patient.id);
      showToast("Patient saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCourseForm() {
    if (!courseForm) return;
    setBusy(true);
    try {
      const isEditing = Boolean(courseForm.id);
      if (!appClient) return;
      const isCompletingPendingCourse = courseFormMode === "full" && courseForm.status === "pending";
      const nextCourseForm =
        isCompletingPendingCourse
          ? { ...courseForm, status: "active" as const }
          : courseForm;
      const course = await appClient.saveCourse(nextCourseForm);
      clearCourseRecoveryFor(courseForm);
      const shouldAttachFacePhoto =
        isCompletingPendingCourse &&
        courseCompletionNeedsFacePhoto &&
        courseCompletionFacePhotoUpload;
      if (shouldAttachFacePhoto) {
        const detail =
          patientDetail?.patient.id === course.patientId
            ? patientDetail
            : await appClient.getPatientDetail(course.patientId);
        if (!detail.patient.facePhoto) {
          await appClient.savePatient({
            ...toPatientFormInput(detail.patient),
            facePhotoUpload: courseCompletionFacePhotoUpload
          });
        }
      }
      if (isCompletingPendingCourse) {
        await appClient.generateCourseSimWorksheet(course.id);
      }
      setCourseForm(null);
      setCourseFormMode("full");
      setCourseCompletionFacePhotoUpload(null);
      setCourseCompletionNeedsFacePhoto(false);
      setScreen({ name: "patient", patientId: course.patientId });
      await loadDashboard();
      await loadPatient(course.patientId);
      if (courseFormMode === "intake") {
        showToast(isEditing ? "Path intake updated. Re-sign consent if details changed." : "Consent intake saved.");
      } else if (courseForm.status === "pending") {
        showToast("Course setup completed and sim worksheet generated.");
      } else {
        showToast(isEditing ? "Treatment course updated." : "Treatment course saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function printCourseSchedule(courseId: string) {
    if (!appClient) return;
    const currentYear = new Date().getFullYear();
    const snapshot = await appClient.getScheduleSnapshot(`${currentYear - 1}-01-01`, `${currentYear + 2}-12-31`);
    const appointments = snapshot.appointments
      .filter((appointment) => appointment.courseId === courseId && appointment.appointmentType === "treatment" && appointment.status !== "cancelled")
      .sort((left, right) => `${left.appointmentDate}|${left.startTime}`.localeCompare(`${right.appointmentDate}|${right.startTime}`));
    if (!appointments.length) {
      window.alert("No treatment schedule has been created for this course yet.");
      return;
    }
    printPatientSchedule(appointments[0].patientName, appointments);
  }

  async function deleteCourseTreatmentSchedule(courseId: string) {
    if (!appClient) return false;
    if (!window.confirm("Delete all treatment appointments for this course? This keeps the patient chart and notes, but removes the treatment schedule from the calendar.")) {
      return false;
    }
    const deletedCount = await appClient.deleteCourseTreatmentSchedule(courseId);
    if (patientDetail?.patient.id) {
      await loadPatient(patientDetail.patient.id);
    }
    await loadDashboard();
    showToast(deletedCount ? "Treatment schedule deleted." : "No treatment appointments were found.");
    return true;
  }

  async function startScheduleAppointmentNote(appointment: ScheduleAppointmentRecord) {
    if (!appClient) return;
    if (appointment.appointmentType === "follow_up") {
      window.alert("Follow-up appointments can be tracked on the schedule, but follow-up note generation is not built yet.");
      return;
    }
    if (!appointment.courseId || !appointment.patientId) {
      window.alert("Link this appointment to Active Patients before starting a note.");
      return;
    }

    const detail = await appClient.getPatientDetail(appointment.patientId).catch(() => null);
    const courseDetail = detail?.courses.find((item) => item.course.id === appointment.courseId);
    if (!detail || !courseDetail) {
      window.alert("This scheduled appointment is not linked to a patient course.");
      return;
    }
    if (courseDetail.course.status === "pending") {
      setScreen({ name: "patient", patientId: appointment.patientId });
      showToast("Complete course setup before starting this scheduled note.");
      return;
    }

    setScreen({
      name: "visit",
      courseId: appointment.courseId,
      mode: appointment.appointmentType === "sim_consult" ? "consult_sim" : "next_treatment",
      visitDate: appointment.appointmentDate,
      treatmentNumber: appointment.appointmentType === "treatment" ? appointment.appointmentNumber : null
    });
  }

  async function deleteCourseForm() {
    if (!courseForm?.id) {
      return;
    }
    setBusy(true);
    try {
      const patientId = courseForm.patientId;
        if (!appClient) return;
      if (courseForm.status !== "pending") {
          await appClient.saveCourse({
            ...courseForm,
            status: "pending"
          });
          clearCourseRecoveryFor(courseForm);
          setCourseForm(null);
          setCourseFormMode("full");
          setCourseCompletionNeedsFacePhoto(false);
          setCourseCompletionFacePhotoUpload(null);
          await loadDashboard();
          const refreshed = await appClient.getPatientDetail(patientId).catch(() => null);
          if (!refreshed) {
            setScreen({ name: "dashboard" });
            showToast("Course moved back to pending intake.");
            return;
          }
          setPatientDetail(refreshed);
          setScreen({ name: "patient", patientId });
          showToast("Course moved back to pending intake.");
          return;
        }
      await appClient.deleteCourse(courseForm.id);
      clearCourseRecoveryFor(courseForm);
      setCourseForm(null);
        setCourseFormMode("full");
        setCourseCompletionNeedsFacePhoto(false);
        setCourseCompletionFacePhotoUpload(null);
        await loadDashboard();
      const refreshed = await appClient.getPatientDetail(patientId).catch(() => null);
      if (!refreshed) {
        setScreen({ name: "dashboard" });
        showToast("Course removed.");
        return;
      }
      setPatientDetail(refreshed);
      setScreen({ name: "patient", patientId });
      showToast("Course removed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDocumentOnlyForm() {
    if (!documentOnlyForm || !appClient) {
      return;
    }
    setBusy(true);
    try {
      const isEditing = Boolean(documentOnlyForm.id);
      await appClient.saveDocumentOnlyRecord(documentOnlyForm);
      clearDocumentOnlyRecoveryFor(documentOnlyForm);
      setDocumentOnlyForm(null);
      setScreen({ name: "documents" });
      await loadDocumentOnly();
      showToast(
        isEditing
          ? "Document record updated. Re-sign consent or regenerate the sim worksheet if details changed."
          : "Document record saved."
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocumentOnlyForm(recordId?: string) {
    if (!recordId || !appClient) {
      return;
    }
    setBusy(true);
    try {
      await appClient.deleteDocumentOnlyRecord(recordId);
      clearDocumentOnlyRecoveryFor(documentOnlyForm);
      clearDocumentOnlyWorksheetRecoveryFor(documentOnlyWorksheetForm);
      setDocumentOnlyForm(null);
      setDocumentOnlyWorksheetForm(null);
      await loadDocumentOnly();
      showToast("Document record deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function generateConsentFormForCourse(courseId: string) {
    // Kept for compatibility with existing button naming.
    const ownerPatientId =
      dashboard?.pendingCourses.find((course) => course.courseId === courseId)?.patientId ??
      dashboard?.activeCourses.find((course) => course.courseId === courseId)?.patientId ??
      patientDetail?.courses.find((courseDetail) => courseDetail.course.id === courseId)?.course.patientId ??
      null;
    if (ownerPatientId) {
      await openConsentSigningForCourse(ownerPatientId, courseId);
    }
  }

  async function generateCourseSimWorksheetForCourse(patientId: string, courseId: string) {
    if (!appClient) return;
    setBusy(true);
    try {
      await appClient.generateCourseSimWorksheet(courseId);
      await loadDashboard();
      await loadPatient(patientId);
      showToast("Sim worksheet generated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate the sim worksheet.";
      showToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadConsentFormForCourse(patientId: string, courseId: string) {
    if (!appClient) return;
    let upload: StoredAssetUpload | null = null;
    try {
      upload = await pickConsentUploadFile();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the consent file.";
      showToast(message);
      return;
    }
    if (!upload) {
      return;
    }

    setBusy(true);
    try {
      await appClient.uploadConsentForm(courseId, upload);
      await loadDashboard();
      await loadPatient(patientId);
      showToast("Signed consent imported and linked to the sim / consult note.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import the signed consent.";
      showToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteConsentFormForCourse(patientId: string, courseId: string) {
    if (!appClient) return;
    if (!window.confirm("Remove the current consent form for this course? This is useful if the wrong consent was imported.")) {
      return;
    }

    setBusy(true);
    try {
      await appClient.deleteConsentForm(courseId);
      if (consentSigning?.course.id === courseId) {
        setConsentSigning(null);
      }
      await loadDashboard();
      await loadPatient(patientId);
      showToast("Consent form removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not remove the consent form.";
      showToast(message);
    } finally {
      setBusy(false);
    }
  }

  async function openConsentSigningForCourse(patientId: string, courseId: string) {
    if (!appClient) return;
    const detail = patientDetail?.patient.id === patientId ? patientDetail : await appClient.getPatientDetail(patientId);
    const targetCourse = detail?.courses.find((courseDetail) => courseDetail.course.id === courseId);
    if (!detail || !targetCourse) {
      return;
    }

    setConsentSigning({
      kind: "course",
      patient: detail.patient,
      course: targetCourse.course,
      sites: targetCourse.sites,
      input: buildDefaultConsentSigningInput(
        detail.patient,
        targetCourse.course,
        settingsPayload?.settings.defaultTherapist || ""
      )
    });
  }

  async function openConsentSigningForDocumentOnly(recordId: string) {
    if (!appClient) return;
    const snapshot = documentOnlySnapshot ?? (await appClient.getDocumentOnlySnapshot());
    const detail = snapshot.records.find((record) => record.record.id === recordId);
    if (!detail) {
      return;
    }

    const synthetic = buildDocumentOnlySyntheticContext(detail);
    setConsentSigning({
      kind: "document-only",
      recordId,
      patient: synthetic.patient,
      course: synthetic.course,
      sites: synthetic.sites,
      input: createDefaultDocumentOnlyConsentSigningInput(detail)
    });
  }

  async function finalizeConsentSigning() {
    if (!consentSigning || !appClient) return;
    setBusy(true);
    try {
      if (consentSigning.kind === "course") {
        await appClient.finalizeConsentForm(consentSigning.course.id, consentSigning.input);
      } else {
        await appClient.finalizeDocumentOnlyConsent(consentSigning.recordId, consentSigning.input);
      }
      clearConsentSigningRecoveryFor(consentSigning);
      setConsentSigning(null);
      if (consentSigning.kind === "course") {
        await loadDashboard();
        if (patientDetail?.patient.id === consentSigning.patient.id) {
          await loadPatient(consentSigning.patient.id);
        }
      } else {
        await loadDocumentOnly();
      }
      showToast("Consent form signed and saved.");
    } finally {
      setBusy(false);
    }
  }

  async function openDocumentOnlyWorksheetSetup(recordId: string) {
    if (!appClient) {
      return;
    }

    const snapshot = documentOnlySnapshot ?? (await appClient.getDocumentOnlySnapshot());
    const detail = snapshot.records.find((record) => record.record.id === recordId);
    if (!detail) {
      return;
    }

    setDocumentOnlyWorksheetForm(createDocumentOnlyInputFromDetail(detail));
  }

  async function saveAndGenerateDocumentOnlySimWorksheet() {
    if (!documentOnlyWorksheetForm || !appClient) {
      return;
    }

    setBusy(true);
    try {
      const saved = await appClient.saveDocumentOnlyRecord(documentOnlyWorksheetForm);
      clearDocumentOnlyWorksheetRecoveryFor(documentOnlyWorksheetForm);
      await appClient.generateDocumentOnlySimWorksheet(saved.id);
      setDocumentOnlyWorksheetForm(null);
      await loadDocumentOnly();
      showToast("Sim worksheet generated.");
    } finally {
      setBusy(false);
    }
  }

  async function saveVisit(generatePdf = false) {
    if (!visitEditor) return;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setBusy(true);
    try {
      if (!appClient) return;
      const currentPatientId = visitEditor.patient.id;
      const noteInput = generatePdf
        ? { ...visitEditor.note, status: "finalized" as const }
        : visitEditor.note;
      const saved = await appClient.saveVisit(noteInput);
      autosaveSignatureRef.current = JSON.stringify({
        ...buildAutosaveVisitInput(noteInput),
        id: saved.id,
        status: saved.status,
        generatedText: saved.generatedText,
        editedText: noteInput.editedText
      });
      let revealTarget = null;
      if (generatePdf) {
        const pdfResult = await appClient.generatePdf(saved.id);
        revealTarget = pdfResult.pdfAsset;
        await appClient.completeScheduleAppointmentForVisit(saved.id);
        await loadPatient(currentPatientId);
        setScreen({ name: "patient", patientId: currentPatientId });
      } else {
        await loadVisit(visitEditor.course.id, "next_treatment", saved.id);
      }
      showToast(generatePdf ? "Visit saved and PDF generated." : "Visit saved.");
      if (revealTarget) {
        await appClient.revealAsset(revealTarget);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveSettingsForm() {
    if (!settingsPayload) return;
    if (!appClient) return;
    const settings = await appClient.saveSettings(settingsPayload.settings);
    setSettingsPayload((current) => (current ? { ...current, settings } : current));
    setBoot((current) => (current ? { ...current, settings } : current));
    showToast("Settings updated.");
  }

  async function saveTemplateDraft() {
    const selected = templates.find((template) => template.id === selectedTemplateId);
    if (!selected) return;
    if (!appClient) return;
    const saved = await appClient.saveTemplate(selected.id, templateDraft);
    setTemplates((current) => current.map((template) => (template.id === saved.id ? saved : template)));
    showToast("Template updated.");
  }

  async function resetTemplateDraft() {
    const selected = templates.find((template) => template.id === selectedTemplateId);
    if (!selected) return;
    if (!appClient) return;
    const reset = await appClient.resetTemplate(selected.id);
    setTemplates((current) => current.map((template) => (template.id === reset.id ? reset : template)));
    setTemplateDraft(reset.templateText);
    showToast("Template reset.");
  }

  async function submitPinChange() {
    if (changePin.nextPin !== changePin.confirmPin) {
      setStatusMessage("New PIN confirmation does not match.");
      return;
    }
    if (!appClient) return;
    await appClient.changePin(changePin.currentPin, changePin.nextPin);
    setChangePin({ currentPin: "", nextPin: "", confirmPin: "" });
    showToast("PIN updated.");
  }

  async function importPatientArchive() {
    setArchiveExportResult(null);
    setArchiveExportError(null);
    setArchiveRestoreResult(null);
    setArchivePreflightResult(null);
    if (!appClient) return;
    const archiveHandle = await appClient.pickPatientArchive();
    if (!archiveHandle) {
      return;
    }

    setArchiveActionBusy(true);
    try {
      const result = await appClient.preflightPatientArchive(archiveHandle);
      setArchivePreflightResult(result);
      setScreen({ name: "completed" });
      const patientName = result.manifest
        ? `${result.manifest.patientIdentity.firstName} ${result.manifest.patientIdentity.lastName}`.trim()
        : "Selected archive";
      showToast(result.status === "supported" ? `${patientName} archive ready for review.` : `${patientName} archive preflight found blockers.`);
    } finally {
      setArchiveActionBusy(false);
    }
  }

  async function confirmRestorePatientArchive() {
    if (!archivePreflightResult) {
      return;
    }

    setArchiveActionBusy(true);
    try {
      if (!appClient) return;
      const result = await appClient.restorePatientArchive(archivePreflightResult.sourceArchive);
      setArchivePreflightResult(null);
      setArchiveRestoreResult(result);
      await refreshWorkflowSnapshots();
      if (result.status === "restored") {
        await loadPatient(result.patientId).catch(() => undefined);
        showToast("Patient archive restored. Review the patient record or start a new course.");
      } else {
        showToast("Archive restore blocked.");
      }
      setScreen({ name: "completed" });
    } finally {
      setArchiveActionBusy(false);
    }
  }

  async function exportPatientArchive(patientId: string) {
    setArchiveExportResult(null);
    setArchiveExportError(null);
    setArchiveExportBusyPatientId(patientId);
    try {
      if (!appClient) return;
      const result = await appClient.exportPatientArchive(patientId);
      setArchiveExportResult(result);
      showToast(
        result.missingAssetCount > 0
          ? `Archive exported with ${result.missingAssetCount} missing asset warning(s).`
          : "Patient archive exported."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Archive export failed.";
      setArchiveExportError(message);
      showToast(message);
    } finally {
      setArchiveExportBusyPatientId(null);
    }
  }

  const updateBanner = updateReady ? (
    <div className="update-banner">
      <span>A new version is available.</span>
      <button onClick={() => window.location.reload()}>Refresh</button>
    </div>
  ) : null;

  if (!boot) {
    return (
      <>
        <div className="loading-screen">
          <div>
            <div>Loading application...</div>
            {bootError ? <p className="loading-error">{bootError}</p> : null}
          </div>
        </div>
        {updateBanner}
        {showInstallPrompt ? (
          <InstallPromptBanner
            setupFirst={false}
            onDismiss={() => {
              try {
                window.localStorage.setItem("install-prompt-dismissed", "true");
              } catch {
                // Ignore storage write failures; banner still dismisses for the current session.
              }
              setShowInstallPrompt(false);
            }}
          />
        ) : null}
      </>
    );
  }

  const activeLogoSrc = appBrandLogo;
  const authLogoSrc = defaultNoteLogo;

  if (pendingRecoveryCode) {
    return (
      <>
        <RecoveryCodeScreen
          appName={boot.settings.appName}
          logoSrc={authLogoSrc}
          recoveryCode={pendingRecoveryCode}
          onAcknowledge={() => setPendingRecoveryCode(null)}
        />
        {updateBanner}
        {showInstallPrompt ? (
          <InstallPromptBanner
            onDismiss={() => {
              try {
                window.localStorage.setItem("install-prompt-dismissed", "true");
              } catch {
                // Ignore storage write failures; banner still dismisses for the current session.
              }
              setShowInstallPrompt(false);
            }}
          />
        ) : null}
      </>
    );
  }

  if (browserRecoveryFlow === "recover_pin") {
    return (
      <>
        <PinRecoveryScreen
          appName={boot.settings.appName}
          logoSrc={authLogoSrc}
          recoveryCode={recoveryCodeInput}
          nextPin={recoveryNextPin}
          confirmPin={recoveryConfirmPin}
          statusMessage={statusMessage}
          showWipeOption={showWipeOption}
          onRecoveryCodeChange={setRecoveryCodeInput}
          onNextPinChange={setRecoveryNextPin}
          onConfirmPinChange={setRecoveryConfirmPin}
          onSubmit={() => void handleRecoveryReset()}
          onCancel={() => {
            setBrowserRecoveryFlow("auth");
            setRecoveryCodeInput("");
            setRecoveryNextPin("");
            setRecoveryConfirmPin("");
            setShowWipeOption(false);
            setStatusMessage("");
          }}
          onWipe={() => {
            setBrowserRecoveryFlow("wipe_data");
            setStatusMessage("");
          }}
        />
        {updateBanner}
        {showInstallPrompt ? (
          <InstallPromptBanner
            onDismiss={() => {
              try {
                window.localStorage.setItem("install-prompt-dismissed", "true");
              } catch {
                // Ignore storage write failures; banner still dismisses for the current session.
              }
              setShowInstallPrompt(false);
            }}
          />
        ) : null}
      </>
    );
  }

  if (browserRecoveryFlow === "wipe_data") {
    return (
      <>
        <WipeLocalDataScreen
          appName={boot.settings.appName}
          logoSrc={authLogoSrc}
          confirmationText={wipeConfirmationText}
          statusMessage={statusMessage}
          onConfirmationTextChange={setWipeConfirmationText}
          onCancel={() => {
            setBrowserRecoveryFlow("recover_pin");
            setWipeConfirmationText("");
            setStatusMessage("");
          }}
          onConfirm={() => void handleWipeAllData()}
        />
        {updateBanner}
        {showInstallPrompt ? (
          <InstallPromptBanner
            onDismiss={() => {
              try {
                window.localStorage.setItem("install-prompt-dismissed", "true");
              } catch {
                // Ignore storage write failures; banner still dismisses for the current session.
              }
              setShowInstallPrompt(false);
            }}
          />
        ) : null}
      </>
    );
  }

  if (boot.requiresPinSetup || boot.isLocked) {
    return (
      <>
        <LockScreen
          appName={boot.settings.appName}
          logoSrc={authLogoSrc}
          defaultNoteLogoSrc={defaultNoteLogo}
          requiresPinSetup={boot.requiresPinSetup}
          statusMessage={statusMessage}
          unlockPin={unlockPin}
          setupPin={setupPin}
          confirmPin={confirmPin}
          setupSettings={setupSettings ?? { ...boot.settings, inactivityTimeoutMinutes: 5 }}
          onUnlockPinChange={setUnlockPin}
          onSetupPinChange={setSetupPin}
          onConfirmPinChange={setConfirmPin}
          onSetupSettingsChange={setSetupSettings}
          onSetupLogoSelected={(file) => {
            void startLogoCrop(file, "setup");
          }}
          onRemoveSetupLogo={() =>
            setupSettings
              ? setSetupSettings({
                  ...setupSettings,
                  dermatologyOfficeLogoUpload: null,
                  dermatologyOfficeLogoAsset: null,
                  removeDermatologyOfficeLogo: true
                })
              : undefined
          }
          showSetupInstallPrompt={boot.requiresPinSetup && showInstallPrompt}
          showDesktopDownloadPrompt={boot.requiresPinSetup && shouldShowDesktopDownloadPrompt()}
          desktopDownloadUrl={DESKTOP_DOWNLOAD_URL}
          onDismissSetupInstallPrompt={() => {
            try {
              window.localStorage.setItem("install-prompt-dismissed", "true");
            } catch {
            }
            setShowInstallPrompt(false);
          }}
          onUnlock={() => void handleUnlock()}
          onSetup={() => void handleSetupPin()}
          onForgotPin={!boot.requiresPinSetup ? () => {
            setBrowserRecoveryFlow("recover_pin");
            setRecoveryCodeInput("");
            setRecoveryNextPin("");
            setRecoveryConfirmPin("");
            setShowWipeOption(false);
            setStatusMessage("");
          } : undefined}
        />
        {updateBanner}
        {showInstallPrompt && !boot.requiresPinSetup ? (
          <InstallPromptBanner
            onDismiss={() => {
              try {
                window.localStorage.setItem("install-prompt-dismissed", "true");
              } catch {
                // Ignore storage write failures; banner still dismisses for the current session.
              }
              setShowInstallPrompt(false);
            }}
          />
        ) : null}
        {logoCropState ? (
          <LogoCropModal
            sourceDataUrl={logoCropState.sourceDataUrl}
            onCancel={() => setLogoCropState(null)}
            onConfirm={(selection) => void applyLogoCrop(selection)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div>
              <img className="brand-logo" src={activeLogoSrc} alt="ClearSkin Hub logo" />
            <h1>{boot.settings.appName}</h1>
            <p className="muted">Local-first treatment note workflow</p>
          </div>
          <nav>
            <button className={screen.name === "schedule" ? "nav active" : "nav"} onClick={() => setScreen({ name: "schedule" })}>Schedule</button>
            <button className={screen.name === "dashboard" ? "nav active" : "nav"} onClick={() => setScreen({ name: "dashboard" })}>Active Patients</button>
            <button className={screen.name === "completed" ? "nav active" : "nav"} onClick={() => setScreen({ name: "completed" })}>Completed Patients</button>
            <button className={screen.name === "archive" ? "nav active" : "nav"} onClick={() => setScreen({ name: "archive" })}>Archive</button>
            <button className={screen.name === "documents" ? "nav active" : "nav"} onClick={() => setScreen({ name: "documents" })}>Consent / Sim Docs</button>
            <button className={screen.name === "settings" ? "nav active" : "nav"} onClick={() => setScreen({ name: "settings" })}>Settings</button>
          </nav>
        </aside>

        <main className="content-shell">
          {statusMessage ? <div key={toastKey} className="toast">{statusMessage}</div> : null}

        {screen.name === "dashboard" ? (
          <DashboardScreen
            appClient={appClient}
            dashboard={dashboard}
            completed={completed}
            archive={archive}
            search={dashboardSearch}
            onSearchChange={setDashboardSearch}
            onAddPatient={() => setPatientForm(createEmptyPatientForm())}
            onOpenPatient={(patientId) => setScreen({ name: "patient", patientId })}
            onArchivePatient={(patientId) => void (async () => {
              if (!appClient) return;
              await appClient.archivePatient(patientId);
              await refreshWorkflowSnapshots();
              showToast("Patient moved to Archive and schedule removed.");
            })()}
              onOpenVisit={(courseId, mode, existingVisitId) => setScreen({ name: "visit", courseId, mode, existingVisitId })}
              onEditPendingCourse={(patientId, courseId, mode) => void (async () => {
                if (!appClient) return;
                const detail = await appClient.getPatientDetail(patientId);
                const targetCourse = detail.courses.find((courseDetail) => courseDetail.course.id === courseId);
                if (!targetCourse) {
                  return;
                }
                setCourseForm(createCourseFormFromDetail(targetCourse));
                setCourseFormMode(mode);
                setCourseCompletionNeedsFacePhoto(mode === "full" && !detail.patient.facePhoto);
                setCourseCompletionFacePhotoUpload(null);
              })()}
              onGenerateConsentForm={(courseId) => void generateConsentFormForCourse(courseId)}
              onUploadConsentForm={(patientId, courseId) => void uploadConsentFormForCourse(patientId, courseId)}
              onScheduleCourse={(courseId) => setScreen({ name: "schedule", courseId })}
              onPrintCourseSchedule={(courseId) => void printCourseSchedule(courseId)}
              onDeleteCourseSchedule={(courseId) => deleteCourseTreatmentSchedule(courseId)}
              onOpenConsentForm={(patientId, courseId) => void (async () => {
                if (!appClient) return;
              const detail = await appClient.getPatientDetail(patientId);
              const targetCourse = detail.courses.find((courseDetail) => courseDetail.course.id === courseId);
              const consentDocument = targetCourse?.documents.find((document) => document.documentType === "consent_form");
              if (consentDocument) {
                await appClient.openAsset(consentDocument.fileAsset);
              }
            })()}
            onRestoreArchivedPatient={(patientId) => void (async () => {
              if (!appClient) return;
              await appClient.restorePatient(patientId);
              await refreshWorkflowSnapshots();
              showToast("Patient restored to active workflow.");
            })()}
          />
        ) : null}

        {screen.name === "patient" && patientDetail ? (
          <PatientScreen
            appClient={appClient}
            patientDetail={patientDetail}
              onEditPatient={() => setPatientForm(toPatientFormInput(patientDetail.patient))}
            onAddCourse={() => {
              setCourseForm(createEmptyConsentCourseForm(patientDetail.patient.id));
              setCourseFormMode("intake");
              setCourseCompletionNeedsFacePhoto(false);
              setCourseCompletionFacePhotoUpload(null);
            }}
            onEditCourse={(courseId) => {
              const targetCourse = patientDetail.courses.find((courseDetail) => courseDetail.course.id === courseId);
              if (!targetCourse) {
                return;
              }
              setCourseForm(createCourseFormFromDetail(targetCourse));
              setCourseFormMode(targetCourse.course.status === "pending" ? "intake" : "full");
              setCourseCompletionNeedsFacePhoto(false);
              setCourseCompletionFacePhotoUpload(null);
            }}
            onEditPathIntake={(courseId) => {
              const targetCourse = patientDetail.courses.find((courseDetail) => courseDetail.course.id === courseId);
              if (!targetCourse) {
                return;
              }
              setCourseConsentActions({
                patientId: patientDetail.patient.id,
                courseId: targetCourse.course.id
              });
            }}
            onCompleteCourseSetup={(courseId) => {
              const targetCourse = patientDetail.courses.find((courseDetail) => courseDetail.course.id === courseId);
              if (!targetCourse) {
                return;
              }
              setCourseForm(createCourseFormFromDetail(targetCourse));
              setCourseFormMode("full");
              setCourseCompletionNeedsFacePhoto(!patientDetail.patient.facePhoto);
              setCourseCompletionFacePhotoUpload(null);
            }}
            onArchivePatient={() => void (async () => {
              if (!appClient) return;
              await appClient.archivePatient(patientDetail.patient.id);
              setScreen({ name: "dashboard" });
              await loadDashboard();
              showToast("Patient moved to Archive and schedule removed.");
            })()}
            onOpenVisit={(courseId, mode, existingVisitId) => setScreen({ name: "visit", courseId, mode, existingVisitId })}
            onScheduleCourse={(courseId) => setScreen({ name: "schedule", courseId })}
            onPrintCourseSchedule={(courseId) => void printCourseSchedule(courseId)}
            onDeleteCourseSchedule={(courseId) => deleteCourseTreatmentSchedule(courseId)}
            onCompleteCourse={(courseId) => void (async () => {
              if (!appClient) return;
              await appClient.completeCourse(courseId);
              await loadPatient(patientDetail.patient.id);
            })()}
            onRestoreCourse={(courseId) => void (async () => {
              if (!appClient) return;
              await appClient.restoreCourse(courseId);
              await loadPatient(patientDetail.patient.id);
            })()}
              onOpenPdf={(asset) => void appClient?.openAsset(asset)}
              onGenerateConsentForm={(courseId) => void generateConsentFormForCourse(courseId)}
              onUploadConsentForm={(patientId, courseId) => void uploadConsentFormForCourse(patientId, courseId)}
              onDeleteVisit={(visitId) => void (async () => {
              if (!appClient) return;
              await appClient.deleteVisit(visitId);
              await loadPatient(patientDetail.patient.id);
              await loadDashboard();
              showToast("Note deleted.");
            })()}
          />
        ) : null}

        {screen.name === "visit" && visitEditor ? (
          <VisitEditorScreen
            appClient={appClient}
            visitEditor={visitEditor}
            settingsPayload={settingsPayload}
            textDirty={textDirty}
            onSaveDraft={() => void saveVisit(false)}
            onSaveAndGeneratePdf={() => void saveVisit(true)}
            onOpenPatient={() => void (async () => {
              if (!appClient) return;
              await appClient.saveVisit(visitEditor.note);
              setScreen({ name: "patient", patientId: visitEditor.patient.id });
            })()}
            onResetNoteText={() => updateVisitEditor((current) => current, { regenerate: true, overwriteEdited: true })}
            onRemoveExistingPhoto={(photoId) => void (async () => {
              if (!appClient) return;
              await appClient.removeVisitPhoto(photoId);
              await loadVisit(visitEditor.course.id, "next_treatment", visitEditor.note.id);
            })()}
            onRemoveExistingAttachment={(attachmentId) => void (async () => {
              if (!appClient) return;
              await appClient.removeVisitAttachment(attachmentId);
              await loadVisit(visitEditor.course.id, "next_treatment", visitEditor.note.id);
            })()}
            onOpenExistingAttachment={(asset) => void appClient?.openAsset(asset)}
            onOpenCourseDocument={(asset) => void appClient?.openAsset(asset)}
            onVisitPhotoAdd={(files, siteNumber) => {
              void (async () => {
                if (!files || !visitEditor) return;
                const uploads = [];
                for (const file of Array.from(files)) {
                  const upload = await fileToCompressedUpload(file, 1600);
                  uploads.push({ ...upload, siteNumber });
                }
                setVisitEditor({ ...visitEditor, note: { ...visitEditor.note, newPhotoUploads: [...visitEditor.note.newPhotoUploads, ...uploads] } });
              })();
            }}
            onVisitAttachmentAdd={(files) => {
              void (async () => {
                if (!files || !visitEditor) return;
                const uploads = [];
                for (const file of Array.from(files)) {
                  uploads.push(
                    file.type.startsWith("image/")
                      ? await fileToCompressedUpload(file, 2200)
                      : await fileToUpload(file)
                  );
                }
                setVisitEditor({
                  ...visitEditor,
                  note: {
                    ...visitEditor.note,
                    newAttachmentUploads: [...visitEditor.note.newAttachmentUploads, ...uploads]
                  }
                });
              })();
            }}
            onUpdate={updateVisitEditor}
            onEditedTextChange={(value) => {
              setTextDirty(true);
              setVisitEditor({ ...visitEditor, note: { ...visitEditor.note, editedText: value } });
            }}
            onOpenLatestPdf={(asset) => void appClient?.openAsset(asset)}
          />
        ) : null}

        {screen.name === "completed" ? (
          <CompletedScreen
            appClient={appClient}
            completed={completed}
            dashboard={dashboard}
            archive={archive}
            search={completedSearch}
            archiveActionBusy={archiveActionBusy}
            archiveExportBusyPatientId={archiveExportBusyPatientId}
            exportResult={archiveExportResult}
            exportError={archiveExportError}
            preflightResult={archivePreflightResult}
            restoreResult={archiveRestoreResult}
            onSearchChange={setCompletedSearch}
            onOpenPatient={(patientId) => setScreen({ name: "patient", patientId })}
            onAddCourse={(patientId) => {
              setScreen({ name: "patient", patientId });
              setCourseForm(createEmptyConsentCourseForm(patientId));
              setCourseFormMode("intake");
              setCourseCompletionNeedsFacePhoto(false);
              setCourseCompletionFacePhotoUpload(null);
            }}
            onOpenVisit={(courseId, existingVisitId) => setScreen({ name: "visit", courseId, mode: "next_treatment", existingVisitId })}
            onOpenPdf={(asset) => void appClient?.openAsset(asset)}
            onExportArchive={(patientId) => void exportPatientArchive(patientId)}
            onOpenArchivePath={(targetPath) => void appClient?.openPath(targetPath)}
            onRevealExportPath={(targetPath) => void appClient?.revealPath(targetPath)}
            onDismissExportResult={() => {
              setArchiveExportResult(null);
              setArchiveExportError(null);
            }}
            onImportArchive={() => void importPatientArchive()}
            onPickAnotherArchive={() => void importPatientArchive()}
            onConfirmRestoreArchive={() => void confirmRestorePatientArchive()}
            onDismissPreflightResult={() => setArchivePreflightResult(null)}
            onDismissRestoreResult={() => setArchiveRestoreResult(null)}
            onRestoreArchivedPatient={(patientId) => void (async () => {
              if (!appClient) return;
              await appClient.restorePatient(patientId);
              await refreshWorkflowSnapshots();
              showToast("Patient restored to active workflow.");
            })()}
          />
        ) : null}

        {screen.name === "archive" ? (
          <ArchiveScreen
            appClient={appClient}
            archive={archive}
            dashboard={dashboard}
            completed={completed}
            search={archiveSearch}
            onSearchChange={setArchiveSearch}
            onRestore={(patientId) => void (async () => {
              if (!appClient) return;
              const detail = archive?.patients.find((item) => item.patient.id === patientId);
              await appClient.restorePatient(patientId);
              if (detail) {
                const inactiveCourses = detail.courses.filter((courseDetail) => courseDetail.course.status !== "active");
                await Promise.all(inactiveCourses.map((courseDetail) => appClient.restoreCourse(courseDetail.course.id)));
              }
              await refreshWorkflowSnapshots();
            })()}
            onOpenPatient={(patientId) => setScreen({ name: "patient", patientId })}
            onPermanentlyDeletePatient={(patientId) => void (async () => {
              if (!appClient) return;
              await appClient.permanentlyDeletePatient(patientId);
              void loadArchive();
              void loadDashboard();
            })()}
          />
        ) : null}

        {screen.name === "documents" ? (
          <DocumentOnlyScreen
            snapshot={documentOnlySnapshot}
            search={documentOnlySearch}
            onSearchChange={setDocumentOnlySearch}
            onAddRecord={() =>
              setDocumentOnlyForm(
                createEmptyDocumentOnlyInput(
                  settingsPayload?.settings.defaultTherapist || boot.settings.defaultTherapist || ""
                )
              )
            }
            onEditRecord={(recordId) => {
              const detail = documentOnlySnapshot?.records.find((record) => record.record.id === recordId);
              if (!detail) {
                return;
              }
              setDocumentOnlyForm(createDocumentOnlyInputFromDetail(detail));
            }}
            onDeleteRecord={(recordId) => {
              if (!window.confirm("Delete this document-only record and its generated files?")) {
                return;
              }
              void deleteDocumentOnlyForm(recordId);
            }}
            onReviewConsent={(recordId) => void openConsentSigningForDocumentOnly(recordId)}
            onGenerateSimWorksheet={(recordId) => void openDocumentOnlyWorksheetSetup(recordId)}
            onOpenConsent={(asset) => void appClient?.openAsset(asset)}
            onOpenSimWorksheet={(asset) => void appClient?.openAsset(asset)}
          />
        ) : null}

        {screen.name === "schedule" ? (
          <ScheduleScreen
            appClient={appClient}
            initialCourseId={screen.courseId}
            onOpenPatient={(patientId) => setScreen({ name: "patient", patientId })}
            onStartAppointmentNote={(appointment) => void startScheduleAppointmentNote(appointment)}
            onNotify={showToast}
          />
        ) : null}

        {screen.name === "settings" && settingsPayload ? (
          <SettingsScreen
            appClient={appClient}
            settingsPayload={settingsPayload}
            defaultLogoSrc={defaultNoteLogo}
            changePin={changePin}
            onSettingsChange={(settings) => setSettingsPayload({ ...settingsPayload, settings })}
            onChangePin={setChangePin}
            onSave={() => void saveSettingsForm()}
            onSubmitPin={() => void submitPinChange()}
            onLockApp={() => void lockApp()}
            onLogoSelected={(file) => {
              void startLogoCrop(file, "settings");
            }}
            onRemoveLogo={() =>
              setSettingsPayload({
                ...settingsPayload,
                settings: {
                  ...settingsPayload.settings,
                  dermatologyOfficeLogoUpload: null,
                  dermatologyOfficeLogoAsset: null,
                  removeDermatologyOfficeLogo: true
                }
              })
            }
          />
        ) : null}
        </main>

          {recoveryDraftPrompt ? (
            <div className="modal-backdrop">
              <div className="modal-card">
                <h3>Unsaved Edits Found</h3>
                <p>
                  The app found unsaved {recoveryDraftPrompt.label} from{" "}
                  {formatRecoveryDraftTime(recoveryDraftPrompt.savedAt)}.
                </p>
                <p className="muted">
                  Restore these edits, or discard the recovery draft if you no longer need it.
                </p>
                <div className="button-row">
                  <button onClick={() => discardRecoveryDraft(recoveryDraftPrompt)}>Discard</button>
                  <button className="primary" onClick={() => restoreRecoveryDraft(recoveryDraftPrompt)}>
                    Restore Edits
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {patientForm ? (
            <PatientModal
              patientForm={patientForm}
              busy={busy}
              onChange={setPatientForm}
              onClose={() => {
                clearPatientRecoveryFor(patientForm);
                setPatientForm(null);
              }}
              onSave={() => void savePatientForm()}
              onFacePhotoSelected={(file) => {
                void (async () => {
                  if (!file || !patientForm) return;
                  const upload = await fileToCompressedUpload(file, 900);
                  setPatientForm({ ...patientForm, facePhotoUpload: upload });
                })();
              }}
            />
          ) : null}

          {courseForm ? (
          courseFormMode === "intake" ? (
              <PendingCourseIntakeModal
                courseForm={courseForm}
                busy={busy}
                onChange={setCourseForm}
                onClose={() => {
                  clearCourseRecoveryFor(courseForm);
                  setCourseForm(null);
                  setCourseFormMode("full");
                  setCourseCompletionNeedsFacePhoto(false);
                  setCourseCompletionFacePhotoUpload(null);
                }}
                onSave={() => void saveCourseForm()}
                onDelete={() => void deleteCourseForm()}
              />
            ) : (
              <CourseModal
                courseForm={courseForm}
                busy={busy}
                showFacePhotoPicker={courseForm.status === "pending" && courseCompletionNeedsFacePhoto}
                facePhotoUploadName={courseCompletionFacePhotoUpload?.name}
                onChange={setCourseForm}
                onClose={() => {
                  clearCourseRecoveryFor(courseForm);
                  setCourseForm(null);
                  setCourseFormMode("full");
                  setCourseCompletionNeedsFacePhoto(false);
                  setCourseCompletionFacePhotoUpload(null);
                }}
                onFacePhotoSelected={(file) => {
                  void (async () => {
                    if (!file) {
                      setCourseCompletionFacePhotoUpload(null);
                      return;
                    }
                    const upload = await fileToCompressedUpload(file, 900);
                    setCourseCompletionFacePhotoUpload(upload);
                  })();
                }}
                onSave={() => void saveCourseForm()}
                onDelete={() => void deleteCourseForm()}
              />
            )
          ) : null}
          {documentOnlyForm ? (
            <DocumentOnlyRecordModal
              recordForm={documentOnlyForm}
              busy={busy}
              onChange={setDocumentOnlyForm}
              onClose={() => {
                clearDocumentOnlyRecoveryFor(documentOnlyForm);
                setDocumentOnlyForm(null);
              }}
              onSave={() => void saveDocumentOnlyForm()}
              onDelete={
                documentOnlyForm.id
                  ? () => {
                      if (!window.confirm("Delete this document-only record and its generated files?")) {
                        return;
                      }
                      void deleteDocumentOnlyForm(documentOnlyForm.id);
                    }
                  : undefined
              }
            />
          ) : null}
          {documentOnlyWorksheetForm ? (
            <DocumentOnlyWorksheetModal
              recordForm={documentOnlyWorksheetForm}
              busy={busy}
              onChange={setDocumentOnlyWorksheetForm}
              onClose={() => {
                clearDocumentOnlyWorksheetRecoveryFor(documentOnlyWorksheetForm);
                setDocumentOnlyWorksheetForm(null);
              }}
              onSave={() => void saveAndGenerateDocumentOnlySimWorksheet()}
            />
          ) : null}
          {courseConsentActions && patientDetail ? (() => {
            const targetCourse = patientDetail.courses.find((courseDetail) => courseDetail.course.id === courseConsentActions.courseId);
            if (!targetCourse) {
              return null;
            }
            const consentDocument = targetCourse.documents.find((document) => document.documentType === "consent_form") ?? null;
            const simWorksheetDocument = targetCourse.documents.find((document) => document.documentType === "sim_worksheet") ?? null;
            return (
              <CourseConsentModal
                courseName={targetCourse.course.courseName || "this course"}
                hasConsentForm={Boolean(consentDocument)}
                hasSimWorksheet={Boolean(simWorksheetDocument)}
                busy={busy}
                onClose={() => setCourseConsentActions(null)}
                onOpenConsentForm={() => {
                  if (consentDocument) {
                    void appClient?.openAsset(consentDocument.fileAsset);
                  }
                }}
                onGenerateConsentForm={() => {
                  setCourseConsentActions(null);
                  void generateConsentFormForCourse(targetCourse.course.id);
                }}
                onUploadConsentForm={() => void uploadConsentFormForCourse(targetCourse.course.patientId, targetCourse.course.id)}
                onOpenSimWorksheet={() => {
                  if (simWorksheetDocument) {
                    void appClient?.openAsset(simWorksheetDocument.fileAsset);
                  }
                }}
                onGenerateSimWorksheet={() => {
                  setCourseConsentActions(null);
                  void generateCourseSimWorksheetForCourse(targetCourse.course.patientId, targetCourse.course.id);
                }}
              />
            );
          })() : null}
          {consentSigning ? (
            <ConsentSigningModal
              patient={consentSigning.patient}
              course={consentSigning.course}
              sites={consentSigning.sites}
              signingInput={consentSigning.input}
              busy={busy}
              onChange={(next) => setConsentSigning((current) => (current ? { ...current, input: next } : current))}
              onClose={() => {
                clearConsentSigningRecoveryFor(consentSigning);
                setConsentSigning(null);
              }}
              onSave={() => void finalizeConsentSigning()}
            />
          ) : null}
        </div>
      {updateBanner}
      {showInstallPrompt ? (
        <InstallPromptBanner
          onDismiss={() => {
            try {
              window.localStorage.setItem("install-prompt-dismissed", "true");
            } catch {
              // Ignore storage write failures; banner still dismisses for the current session.
            }
            setShowInstallPrompt(false);
          }}
        />
      ) : null}
      {logoCropState ? (
        <LogoCropModal
          sourceDataUrl={logoCropState.sourceDataUrl}
          onCancel={() => setLogoCropState(null)}
          onConfirm={(selection) => void applyLogoCrop(selection)}
        />
      ) : null}
    </>
  );
}
