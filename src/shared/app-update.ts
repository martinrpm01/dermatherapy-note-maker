export const DESKTOP_RELEASE_API_URL =
  "https://api.github.com/repos/martinrpm01/dermatherapy-note-maker/releases/latest";
export const DESKTOP_INSTALLER_DOWNLOAD_URL =
  "https://github.com/martinrpm01/dermatherapy-note-maker/releases/latest/download/ClearSkin-Hub-Setup.exe";

export type AppUpdateRuntime = "desktop" | "browser";
export type AppUpdateStatus = "current" | "available" | "unavailable";
export type AppUpdateAction = "download" | "refresh" | "none";

export interface DesktopBuildInfo {
  appVersion: string;
  releaseTag: string;
  commit: string;
  builtAt: string;
}

export interface AppUpdateCheckResult {
  runtime: AppUpdateRuntime;
  status: AppUpdateStatus;
  action: AppUpdateAction;
  currentVersionLabel: string;
  latestVersionLabel: string | null;
  message: string;
  checkedAt: string;
  downloadUrl?: string;
  releaseUrl?: string;
}

declare const __CLEARSKIN_DESKTOP_BUILD__: DesktopBuildInfo | undefined;

export function getDesktopBuildInfo(): DesktopBuildInfo {
  return typeof __CLEARSKIN_DESKTOP_BUILD__ === "undefined"
    ? {
        appVersion: "0.0.0",
        releaseTag: "",
        commit: "",
        builtAt: ""
      }
    : __CLEARSKIN_DESKTOP_BUILD__;
}

export function normalizeReleaseTag(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function isSameDesktopRelease(currentTag: string | null | undefined, latestTag: string | null | undefined) {
  const current = normalizeReleaseTag(currentTag);
  const latest = normalizeReleaseTag(latestTag);
  return Boolean(current && latest && current === latest);
}

export function formatDesktopBuildLabel(build: DesktopBuildInfo) {
  if (build.releaseTag.trim()) {
    return build.releaseTag.trim();
  }

  const shortCommit = build.commit ? build.commit.slice(0, 12) : "local";
  return `${build.appVersion || "0.0.0"} (${shortCommit})`;
}
