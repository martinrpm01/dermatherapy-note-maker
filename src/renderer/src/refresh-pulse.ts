import type { AppUpdateCheckResult } from "../../shared/types";

export type RefreshPulse = {
  id: string;
  version: string;
  commit: string;
  generatedAt: string;
};

export const REFRESH_PULSE_URL = "/refresh-pulse.json";
export const REFRESH_PULSE_CHECK_INTERVAL_MS = 60_000;
export const CURRENT_REFRESH_PULSE: RefreshPulse =
  typeof __CLEARSKIN_REFRESH_PULSE__ === "undefined"
    ? { id: "desktop", version: "desktop", commit: "desktop", generatedAt: "" }
    : __CLEARSKIN_REFRESH_PULSE__;

export function canCheckRefreshPulse() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

export function parseRefreshPulse(value: unknown): RefreshPulse | null {
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

export async function fetchLatestRefreshPulse() {
  const response = await fetch(`${REFRESH_PULSE_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }

  return parseRefreshPulse(await response.json());
}

export async function checkBrowserRefreshUpdate(): Promise<AppUpdateCheckResult> {
  const checkedAt = new Date().toISOString();

  if (!canCheckRefreshPulse()) {
    return {
      runtime: "browser",
      status: "unavailable",
      action: "none",
      currentVersionLabel: CURRENT_REFRESH_PULSE.id,
      latestVersionLabel: null,
      message: "Update check is only available from the installed iPad/browser app.",
      checkedAt
    };
  }

  try {
    const latestPulse = await fetchLatestRefreshPulse();
    if (!latestPulse) {
      throw new Error("Refresh pulse was not available.");
    }

    if (latestPulse.id !== CURRENT_REFRESH_PULSE.id) {
      return {
        runtime: "browser",
        status: "available",
        action: "refresh",
        currentVersionLabel: CURRENT_REFRESH_PULSE.id,
        latestVersionLabel: latestPulse.id,
        message: "A new iPad/browser version is available.",
        checkedAt
      };
    }

    return {
      runtime: "browser",
      status: "current",
      action: "none",
      currentVersionLabel: CURRENT_REFRESH_PULSE.id,
      latestVersionLabel: latestPulse.id,
      message: "This iPad/browser app is up to date.",
      checkedAt
    };
  } catch {
    return {
      runtime: "browser",
      status: "unavailable",
      action: "none",
      currentVersionLabel: CURRENT_REFRESH_PULSE.id,
      latestVersionLabel: null,
      message: "Could not check for updates. Try again when the network is available.",
      checkedAt
    };
  }
}
