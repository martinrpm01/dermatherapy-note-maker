import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

type DesktopBuildInfo = {
  appVersion: string;
  releaseTag: string;
  commit: string;
  builtAt: string;
};

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version?: string };
    return packageJson.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readCommitSha() {
  const envSha = process.env.GITHUB_SHA;
  if (envSha) {
    return envSha;
  }

  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "local";
  }
}

function readReleaseTag() {
  const envRefName = process.env.GITHUB_REF_NAME;
  if (envRefName?.startsWith("desktop-v")) {
    return envRefName;
  }

  return "";
}

function createDesktopBuildInfo(): DesktopBuildInfo {
  return {
    appVersion: readPackageVersion(),
    releaseTag: readReleaseTag(),
    commit: readCommitSha(),
    builtAt: new Date().toISOString()
  };
}

const desktopBuildInfo = createDesktopBuildInfo();

export default defineConfig({
  main: {
    define: {
      __CLEARSKIN_DESKTOP_BUILD__: JSON.stringify(desktopBuildInfo)
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
});
