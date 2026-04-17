import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFileSync, cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import type { OpenDialogOptions } from "electron";

import type { AssetReference, LaunchReadyScreen } from "../shared/types";
import type { PatientArchiveIoHandle } from "../shared/archive";
import type { RadiationNoteRepository } from "./repository";
import type { RadiationNoteService } from "./backend";
import { DesktopBinaryAssetStore } from "./storage/desktop-binary-asset-store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = "Dermatherapy Note Maker";

app.setName(APP_NAME);

// All patient data lives in Desktop/PT notes — no AppData path issues
const HIDDEN_USER_DATA_DIR = path.join(app.getPath("appData"), APP_NAME);
app.setPath("userData", HIDDEN_USER_DATA_DIR);
mkdirSync(HIDDEN_USER_DATA_DIR, { recursive: true });
const USER_DATA = realpathSync.native(HIDDEN_USER_DATA_DIR);

const DESKTOP_PT_NOTES_DIR = path.join(app.getPath("desktop"), "PT notes");
const DESKTOP_PATIENT_NOTES_DIR = path.join(app.getPath("desktop"), "All Patient Notes");
const DESKTOP_PATIENT_ARCHIVES_DIR = path.join(app.getPath("desktop"), "Patient Archives");
const LEGACY_USER_DATA_DIR = path.join(app.getPath("appData"), "dermatherapy-note-maker");
const NOTE_LOGO_PATH = path.join(app.getAppPath(), "assets", "branding", "dermatherapy-note-logo.jpg");

const launchStatusPath = path.join(USER_DATA, "launch-status.json");
const startupLogPath = path.join(USER_DATA, "startup-debug.log");

function getDbPath(rootPath: string) {
  return path.join(rootPath, "data", "dermatherapy-note-maker.sqlite");
}

function migrateLegacyWorkspace(sourceRoot: string, targetRoot: string) {
  if (!existsSync(sourceRoot) || sourceRoot === targetRoot) {
    return false;
  }

  const sourceDbPath = getDbPath(sourceRoot);
  const targetDbPath = getDbPath(targetRoot);
  if (!existsSync(sourceDbPath) || existsSync(targetDbPath)) {
    return false;
  }

  mkdirSync(targetRoot, { recursive: true });
  cpSync(sourceRoot, targetRoot, { recursive: true, force: false });
  return true;
}

function removeLegacyWorkspace(targetRoot: string) {
  if (!existsSync(targetRoot) || targetRoot === USER_DATA) {
    return;
  }

  try {
    rmSync(targetRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors; the migrated copy remains in hidden app data.
  }
}

let mainWindow: BrowserWindow | null = null;
let repository!: RadiationNoteRepository;
let service!: RadiationNoteService;
let assetStore!: DesktopBinaryAssetStore;

function createWindow() {
  const iconPath = path.join(app.getAppPath(), "assets", "branding", "dermatherapy-icon.png");
  const preloadPath = resolvePreloadPath();
  appendStartupLog(`createWindow preload=${preloadPath} exists=${existsSync(preloadPath)}`);
  writeLaunchStatus("loading");
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: "#f5f1e7",
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("dom-ready", () => {
    appendStartupLog("dom-ready");
  });
  mainWindow.webContents.on("did-finish-load", () => {
    appendStartupLog(`did-finish-load url=${mainWindow?.webContents.getURL() ?? ""}`);
  });
  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appendStartupLog(
      `did-fail-load code=${errorCode} mainFrame=${String(isMainFrame)} url=${validatedURL} error=${errorDescription}`
    );
  });
  mainWindow.webContents.on("preload-error", (_, preloadPathValue, error) => {
    appendStartupLog(`preload-error path=${preloadPathValue} error=${error.stack ?? error.message}`);
  });
  mainWindow.webContents.on("console-message", (_, level, message, line, sourceId) => {
    appendStartupLog(`console-message level=${level} source=${sourceId}:${line} message=${message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_, details) => {
    appendStartupLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function resolvePreloadPath() {
  const mjsPath = path.join(__dirname, "../preload/index.mjs");
  if (existsSync(mjsPath)) {
    return mjsPath;
  }

  return path.join(__dirname, "../preload/index.js");
}

function writeLaunchStatus(screen: LaunchReadyScreen) {
  mkdirSync(path.dirname(launchStatusPath), { recursive: true });
  writeFileSync(
    launchStatusPath,
    JSON.stringify(
      {
        appName: APP_NAME,
        screen,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

function appendStartupLog(message: string) {
  mkdirSync(path.dirname(startupLogPath), { recursive: true });
  appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

appendStartupLog("main-process-module-loaded");

function registerIpc() {
  ipcMain.handle("app:bootstrap", () => service.bootstrap());
  ipcMain.handle("app:reportReady", (_, screen: LaunchReadyScreen) => {
    writeLaunchStatus(screen);
  });
  ipcMain.handle("app:unlock", (_, pin: string) => service.unlock(pin));
  ipcMain.handle("app:lock", () => service.lock());
  ipcMain.handle("app:setInitialPin", (_, pin: string) => service.setInitialPin(pin));
  ipcMain.handle("app:changePin", (_, currentPin: string, nextPin: string) => service.changePin(currentPin, nextPin));
  ipcMain.handle("app:resetPinWithRecoveryCode", (_, recoveryCode: string, nextPin: string) =>
    service.resetPinWithRecoveryCode(recoveryCode, nextPin)
  );
  ipcMain.handle("app:wipeAllLocalData", () => service.wipeAllLocalData());

  ipcMain.handle("dashboard:getSnapshot", () => service.getDashboardSnapshot());
  ipcMain.handle("documents:getSnapshot", () => service.getDocumentOnlySnapshot());
  ipcMain.handle("patient:getDetail", (_, patientId: string) => service.getPatientDetail(patientId));
  ipcMain.handle("completed:list", () => service.listCompleted());
  ipcMain.handle("archive:list", () => service.listArchive());
  ipcMain.handle("patient:save", (_, input) => service.savePatient(input));
  ipcMain.handle("patient:archive", (_, patientId: string) => service.archivePatient(patientId));
  ipcMain.handle("patient:restore", (_, patientId: string) => service.restorePatient(patientId));
  ipcMain.handle("patient:delete", (_, patientId: string) => service.deletePatient(patientId));
  ipcMain.handle("patient:permanentDelete", (_, patientId: string) => service.permanentlyDeletePatient(patientId));
  ipcMain.handle("patient:pickArchive", async () => {
    const dialogOptions: OpenDialogOptions = {
      title: "Import Patient Archive",
      properties: ["openFile"],
      filters: [
        { name: "Patient Archives", extensions: ["zip"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return {
      kind: "desktop_path",
      path: result.filePaths[0],
      fileName: path.basename(result.filePaths[0])
    } satisfies PatientArchiveIoHandle;
  });
  ipcMain.handle("patient:exportArchive", (_, patientId: string) => service.exportPatientArchive(patientId));
  ipcMain.handle("patient:preflightArchive", (_, archive: PatientArchiveIoHandle) => service.preflightPatientArchive(archive));
  ipcMain.handle("patient:readArchive", (_, archive: PatientArchiveIoHandle) => service.readPatientArchive(archive));
  ipcMain.handle("patient:restoreArchive", (_, archive: PatientArchiveIoHandle) => service.restorePatientArchive(archive));

  ipcMain.handle("course:save", (_, input) => service.saveCourse(input));
  ipcMain.handle("documents:saveRecord", (_, input) => service.saveDocumentOnlyRecord(input));
  ipcMain.handle("documents:deleteRecord", (_, recordId: string) => service.deleteDocumentOnlyRecord(recordId));
  ipcMain.handle("documents:generateConsent", (_, recordId: string) => service.generateDocumentOnlyConsent(recordId));
  ipcMain.handle("documents:finalizeConsent", (_, recordId: string, input) =>
    service.finalizeDocumentOnlyConsent(recordId, input)
  );
  ipcMain.handle("documents:generateSimWorksheet", (_, recordId: string) => service.generateDocumentOnlySimWorksheet(recordId));
  ipcMain.handle("course:complete", (_, courseId: string) => service.completeCourse(courseId));
  ipcMain.handle("course:restore", (_, courseId: string) => service.restoreCourse(courseId));
  ipcMain.handle("course:delete", (_, courseId: string) => service.deleteCourse(courseId));

  ipcMain.handle(
    "visit:buildDraft",
    (_, courseId: string, mode?: "next_treatment" | "consult_sim", existingVisitId?: string) =>
      service.buildVisitDraft(courseId, mode, existingVisitId)
  );
  ipcMain.handle("visit:save", (_, input) => service.saveVisit(input));
  ipcMain.handle("visit:delete", (_, visitId: string) => service.deleteVisit(visitId));
  ipcMain.handle("visit:generatePdf", (_, visitId: string) => service.generatePdf(visitId));
  ipcMain.handle("visit:generateSimWorksheet", (_, visitId: string) => service.generateSimWorksheet(visitId));
  ipcMain.handle("course:generateConsentForm", (_, courseId: string) => service.generateConsentForm(courseId));
  ipcMain.handle("course:finalizeConsentForm", (_, courseId: string, input) => service.finalizeConsentForm(courseId, input));
  ipcMain.handle("course:uploadConsentForm", (_, courseId: string, upload) => service.uploadConsentForm(courseId, upload));
  ipcMain.handle("course:deleteConsentForm", (_, courseId: string) => service.deleteConsentForm(courseId));
  ipcMain.handle("visit:removePhoto", (_, photoId: string) => service.removeVisitPhoto(photoId));
  ipcMain.handle("visit:removeAttachment", (_, attachmentId: string) => service.removeVisitAttachment(attachmentId));

  ipcMain.handle("settings:getPayload", () => service.getSettingsPayload());
  ipcMain.handle("settings:save", (_, input) => service.saveSettings(input));
  ipcMain.handle("settings:deleteSavedOption", (_, optionId: string) => service.deleteSavedOption(optionId));

  ipcMain.handle("templates:list", () => service.getTemplates());
  ipcMain.handle("templates:save", (_, templateId: string, templateText: string) =>
    service.saveTemplate(templateId, templateText)
  );
  ipcMain.handle("templates:reset", (_, templateId: string) => service.resetTemplate(templateId));

  ipcMain.handle("visit:getFolder", (_, visitId: string) => service.getVisitFolder(visitId));

  ipcMain.handle("files:reveal", (_, targetPath: string) => shell.showItemInFolder(targetPath));
  ipcMain.handle("files:open", async (_, targetPath: string) => {
    await shell.openPath(targetPath);
  });
  ipcMain.handle("files:revealAsset", (_, asset: AssetReference) => {
    const resolvedPath = assetStore.resolveAssetPath(asset);
    if (!resolvedPath) {
      throw new Error("Asset could not be resolved.");
    }
    shell.showItemInFolder(resolvedPath);
  });
  ipcMain.handle("files:openAsset", async (_, asset: AssetReference) => {
    const resolvedPath = assetStore.resolveAssetPath(asset);
    if (!resolvedPath) {
      throw new Error("Asset could not be resolved.");
    }
    await shell.openPath(resolvedPath);
  });
}

app.whenReady().then(async () => {
  appendStartupLog("app-whenReady-entered");
  appendStartupLog("importing-services");
  const [{ RadiationNoteRepository }, { RadiationNoteService }] = await Promise.all([
    import("./repository"),
    import("./backend")
  ]);
  appendStartupLog("service-imports-ready");
  assetStore = new DesktopBinaryAssetStore(path.join(USER_DATA, "storage"));
  repository = new RadiationNoteRepository(USER_DATA, assetStore);
  service = new RadiationNoteService(
    repository,
    assetStore,
    DESKTOP_PATIENT_NOTES_DIR,
    NOTE_LOGO_PATH,
    DESKTOP_PATIENT_ARCHIVES_DIR
  );

  const migratedRoots = [
    DESKTOP_PT_NOTES_DIR,
    LEGACY_USER_DATA_DIR
  ].filter((sourceRoot) => migrateLegacyWorkspace(sourceRoot, USER_DATA));

  appendStartupLog(`legacy-migrations=${migratedRoots.length}`);
  await service.initialize();
  appendStartupLog("service-initialize-complete");
  for (const sourceRoot of migratedRoots) {
    repository.rewriteStoredPathPrefix(sourceRoot, USER_DATA);
    removeLegacyWorkspace(sourceRoot);
  }
  appendStartupLog("legacy-path-rewrite-complete");

  protocol.handle("asset", (request) => {
    const url = new URL(request.url);
    const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const resolvedPath = assetStore.resolveAssetPathById(assetId);
    if (!resolvedPath || !existsSync(resolvedPath)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(resolvedPath).href);
  });

  const bootstrap = service.bootstrap();
  const initialScreen: LaunchReadyScreen = bootstrap.requiresPinSetup
    ? "pin_setup"
    : bootstrap.isLocked
      ? "unlock"
      : "dashboard";
  writeLaunchStatus(initialScreen);
  appendStartupLog(`main-process-ready-screen=${initialScreen}`);

  registerIpc();
  appendStartupLog("ipc-registered");
  createWindow();
  writeLaunchStatus(initialScreen);
  appendStartupLog("createWindow-invoked");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
