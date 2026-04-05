import { useEffect, useState } from "react";

import { useResolvedAssetUrl } from "./asset-url";
import { buildVisitPreviewText, createCourseFormFromDetail, createEmptyCourseForm, createEmptyPatientForm, fileToCompressedUpload, fileToUpload } from "./helpers";
import {
  ArchiveScreen,
  CompletedScreen,
  DashboardScreen,
  InstallPromptBanner,
  LockScreen,
  PatientScreen,
  PinRecoveryScreen,
  RecoveryCodeScreen,
  SettingsScreen,
  WipeLocalDataScreen
} from "./screen-components";
import { PatientModal, CourseModal } from "./modal-components";
import { VisitEditorScreen } from "./visit-editor-screen";
import brandLogo from "./assets/dermatherapy-note-logo.jpg";
import brandIcon from "./assets/dermatherapy-icon.png";
import type { PatientArchiveExportResult, PatientArchivePreflightResult, PatientArchiveRestoreResult } from "../../shared/archive";
import type {
  AppClient,
  ArchiveSnapshot,
  BootstrapPayload,
  CourseInput,
  DashboardSnapshot,
  LaunchReadyScreen,
  PatientDetail,
  PatientInput,
  SettingsPayload,
  TemplateDefinitionRecord,
  VisitEditorState
} from "../../shared/types";

type Screen =
  | { name: "dashboard" }
  | { name: "patient"; patientId: string }
  | { name: "visit"; courseId: string; mode: "next_treatment" | "consult_sim"; existingVisitId?: string }
  | { name: "completed" }
  | { name: "archive" }
  | { name: "settings" };

interface AppProps {
  appClient: AppClient | null;
  initialClientError?: string;
}

type BrowserRecoveryFlow = "auth" | "recover_pin" | "wipe_data";

type InstallAwareNavigator = Navigator & {
  standalone?: boolean;
};

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

export default function App({ appClient, initialClientError = "" }: AppProps) {
  const [boot, setBoot] = useState<BootstrapPayload | null>(null);
  const [bootError, setBootError] = useState(initialClientError);

  function showToast(message: string) {
    setStatusMessage(message);
    setToastKey((k) => k + 1);
    window.setTimeout(() => setStatusMessage(""), 3000);
  }
  const [screen, setScreen] = useState<Screen>({ name: "dashboard" });
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [patientDetail, setPatientDetail] = useState<PatientDetail | null>(null);
  const [completed, setCompleted] = useState<ArchiveSnapshot | null>(null);
  const [completedSearch, setCompletedSearch] = useState("");
  const [archive, setArchive] = useState<ArchiveSnapshot | null>(null);
  const [settingsPayload, setSettingsPayload] = useState<SettingsPayload | null>(null);
  const [templates, setTemplates] = useState<TemplateDefinitionRecord[]>([]);
  const [visitEditor, setVisitEditor] = useState<VisitEditorState | null>(null);
  const [patientForm, setPatientForm] = useState<PatientInput | null>(null);
  const [courseForm, setCourseForm] = useState<CourseInput | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");
  const [textDirty, setTextDirty] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
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
  const resolvedLogoSrc = useResolvedAssetUrl(appClient, boot?.settings.dermatologyOfficeLogoAsset);
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
    if (!("serviceWorker" in navigator)) return;
    const initialController = navigator.serviceWorker.controller;
    const handleControllerChange = () => {
      if (initialController) setUpdateReady(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
  }, []);

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
    if (screen.name === "patient") void loadPatient(screen.patientId);
    if (screen.name === "visit") void loadVisit(screen.courseId, screen.mode, screen.existingVisitId);
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

  async function loadVisit(courseId: string, mode: "next_treatment" | "consult_sim", existingVisitId?: string) {
    if (!appClient) return;
    const editor = await appClient.buildVisitDraft(courseId, mode, existingVisitId);
    setVisitEditor(editor);
    setTextDirty(false);
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
    const recoveryCode = await appClient.setInitialPin(setupPin);
    setPendingRecoveryCode(recoveryCode);
    setBoot(await appClient.bootstrap());
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

  async function savePatientForm() {
    if (!patientForm) return;
    setBusy(true);
    try {
      if (!appClient) return;
      const patient = await appClient.savePatient(patientForm);
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
      const course = await appClient.saveCourse(courseForm);
      setCourseForm(null);
      setScreen({ name: "patient", patientId: course.patientId });
      await loadDashboard();
      await loadPatient(course.patientId);
      showToast(isEditing ? "Treatment course updated." : "Treatment course saved.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCourseForm() {
    if (!courseForm?.id) {
      return;
    }
    setBusy(true);
    try {
      const patientId = courseForm.patientId;
      if (!appClient) return;
      await appClient.deleteCourse(courseForm.id);
      setCourseForm(null);
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

  async function saveVisit(generatePdf = false) {
    if (!visitEditor) return;
    setBusy(true);
    try {
      if (!appClient) return;
      const saved = await appClient.saveVisit(visitEditor.note);
      let revealTarget = null;
      if (generatePdf) {
        const pdfResult = await appClient.generatePdf(saved.id);
        revealTarget = pdfResult.pdfAsset;
      }
      await loadVisit(visitEditor.course.id, "next_treatment", saved.id);
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

  if (!boot) {
    return (
      <>
        <div className="loading-screen">
          <div>
            <div>Loading application...</div>
            {bootError ? <p className="loading-error">{bootError}</p> : null}
          </div>
        </div>
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

  const activeLogoSrc = resolvedLogoSrc || brandLogo;

  if (pendingRecoveryCode) {
    return (
      <>
        <RecoveryCodeScreen
          appName={boot.settings.appName}
          logoSrc={activeLogoSrc}
          recoveryCode={pendingRecoveryCode}
          onAcknowledge={() => setPendingRecoveryCode(null)}
        />
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
          logoSrc={activeLogoSrc}
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
          logoSrc={activeLogoSrc}
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
          logoSrc={activeLogoSrc}
          requiresPinSetup={boot.requiresPinSetup}
          statusMessage={statusMessage}
          unlockPin={unlockPin}
          setupPin={setupPin}
          confirmPin={confirmPin}
          onUnlockPinChange={setUnlockPin}
          onSetupPinChange={setSetupPin}
          onConfirmPinChange={setConfirmPin}
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

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div>
            <img className="brand-logo" src={activeLogoSrc} alt="Dermatherapy logo" />
            <h1>{boot.settings.appName}</h1>
            <p className="muted">Local-first treatment note workflow</p>
          </div>
          <nav>
            <button className={screen.name === "dashboard" ? "nav active" : "nav"} onClick={() => setScreen({ name: "dashboard" })}>Active Workflow</button>
            <button className={screen.name === "completed" ? "nav active" : "nav"} onClick={() => setScreen({ name: "completed" })}>Completed Patients</button>
            <button className={screen.name === "archive" ? "nav active" : "nav"} onClick={() => setScreen({ name: "archive" })}>Archive</button>
            <button className={screen.name === "settings" ? "nav active" : "nav"} onClick={() => setScreen({ name: "settings" })}>Settings</button>
          </nav>
          <button className="ghost" onClick={() => void lockApp()}>Lock App</button>
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
            onOpenVisit={(courseId, mode) => setScreen({ name: "visit", courseId, mode })}
            onRestoreArchivedPatient={(patientId) => void (async () => {
              if (!appClient) return;
              await appClient.restorePatient(patientId);
              await refreshWorkflowSnapshots();
              showToast("Patient restored to active workflow.");
            })()}
            onCompletePatient={(patientId) => void (async () => {
              if (!appClient) return;
              const detail = await appClient.getPatientDetail(patientId);
              const activeCourses = detail.courses.filter((cd) => cd.course.status === "active");
              await Promise.all(activeCourses.map((cd) => appClient.completeCourse(cd.course.id)));
              await refreshWorkflowSnapshots();
              showToast("Patient moved to Completed.");
            })()}
          />
        ) : null}

        {screen.name === "patient" && patientDetail ? (
          <PatientScreen
            appClient={appClient}
            patientDetail={patientDetail}
            onEditPatient={() => setPatientForm({ ...patientDetail.patient })}
            onAddCourse={() => setCourseForm(createEmptyCourseForm(patientDetail.patient.id))}
            onEditCourse={(courseId) => {
              const targetCourse = patientDetail.courses.find((courseDetail) => courseDetail.course.id === courseId);
              if (!targetCourse) {
                return;
              }
              setCourseForm(createCourseFormFromDetail(targetCourse));
            }}
            onCompletePatient={() => void (async () => {
              if (!appClient) return;
              const activeCourses = patientDetail.courses.filter((cd) => cd.course.status === "active");
              await Promise.all(activeCourses.map((cd) => appClient.completeCourse(cd.course.id)));
              await loadDashboard();
              await loadCompleted();
              setScreen({ name: "completed" });
              showToast("Patient moved to Completed.");
            })()}
            onArchivePatient={() => void (async () => {
              if (!appClient) return;
              await appClient.archivePatient(patientDetail.patient.id);
              setScreen({ name: "dashboard" });
              await loadDashboard();
            })()}
            onOpenVisit={(courseId, mode, existingVisitId) => setScreen({ name: "visit", courseId, mode, existingVisitId })}
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
              setCourseForm(createEmptyCourseForm(patientId));
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

        {screen.name === "settings" && settingsPayload ? (
          <SettingsScreen
            appClient={appClient}
            settingsPayload={settingsPayload}
            defaultLogoSrc={brandLogo}
            changePin={changePin}
            onSettingsChange={(settings) => setSettingsPayload({ ...settingsPayload, settings })}
            onChangePin={setChangePin}
            onSave={() => void saveSettingsForm()}
            onSubmitPin={() => void submitPinChange()}
            onLogoSelected={(file) => {
              void (async () => {
                if (!file || !settingsPayload) return;
                const upload = await fileToCompressedUpload(file, 1400);
                setSettingsPayload({
                  ...settingsPayload,
                  settings: {
                    ...settingsPayload.settings,
                    dermatologyOfficeLogoUpload: upload,
                    dermatologyOfficeLogoAsset: settingsPayload.settings.dermatologyOfficeLogoAsset,
                    removeDermatologyOfficeLogo: false
                  }
                });
              })();
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

        {patientForm ? (
          <PatientModal
            patientForm={patientForm}
            busy={busy}
            onChange={setPatientForm}
            onClose={() => setPatientForm(null)}
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
          <CourseModal
            courseForm={courseForm}
            busy={busy}
            onChange={setCourseForm}
            onClose={() => setCourseForm(null)}
            onSave={() => void saveCourseForm()}
            onDelete={() => void deleteCourseForm()}
          />
        ) : null}
      </div>
      {updateReady ? (
        <div className="update-banner">
          <span>A new version is available.</span>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      ) : null}
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
