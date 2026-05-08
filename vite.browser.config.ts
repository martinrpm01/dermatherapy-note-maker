import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

type RefreshPulse = {
  id: string;
  version: string;
  commit: string;
  generatedAt: string;
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
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (envSha) {
    return envSha;
  }

  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "local";
  }
}

function createRefreshPulse(): RefreshPulse {
  const version = readPackageVersion();
  const commit = readCommitSha();
  const generatedAt = new Date().toISOString();
  const shortCommit = commit === "local" ? commit : commit.slice(0, 12);

  return {
    id: `${version}:${shortCommit}:${generatedAt}`,
    version,
    commit,
    generatedAt
  };
}

function refreshPulsePlugin(pulse: RefreshPulse): Plugin {
  return {
    name: "clearskin-refresh-pulse",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "refresh-pulse.json",
        source: `${JSON.stringify(pulse, null, 2)}\n`
      });
    }
  };
}

const refreshPulse = createRefreshPulse();

export default defineConfig({
  // Separate browser build so the Electron renderer config stays untouched.
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  define: {
    __CLEARSKIN_REFRESH_PULSE__: JSON.stringify(refreshPulse)
  },
  plugins: [react(), refreshPulsePlugin(refreshPulse)],
  build: {
    outDir: path.resolve(__dirname, "out-browser"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/renderer/index.browser.html")
    }
  }
});
