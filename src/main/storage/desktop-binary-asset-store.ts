import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { AssetKind, AssetReference, StoredAssetUpload } from "../../shared/types";
import type { BinaryAssetStore } from "../../shared/storage";

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function decodeDataUrl(dataUrl: string) {
  const [, mime = "application/octet-stream", encoded = ""] =
    dataUrl.match(/^data:(.+?);base64,(.+)$/) || [];
  return {
    mimeType: mime,
    buffer: Buffer.from(encoded, "base64")
  };
}

function extFromMime(mimeType: string, fileName: string) {
  const explicit = path.extname(fileName);
  if (explicit) {
    return explicit.toLowerCase();
  }

  if (mimeType.includes("png")) {
    return ".png";
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return ".jpg";
  }

  if (mimeType.includes("pdf")) {
    return ".pdf";
  }

  return ".bin";
}

export class DesktopBinaryAssetStore implements BinaryAssetStore {
  private readonly pathByAssetId = new Map<string, string>();
  private readonly assetIdByPath = new Map<string, string>();

  constructor(readonly rootDir: string) {}

  initialize() {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  getPatientProfileDir(patientId: string) {
    return path.join(this.rootDir, "patients", patientId, "profile");
  }

  getVisitPhotosDir(patientId: string, courseId: string, visitId: string) {
    return path.join(this.getVisitWorkspaceDir(patientId, courseId, visitId), "photos");
  }

  getVisitAttachmentsDir(patientId: string, courseId: string, visitId: string) {
    return path.join(this.getVisitWorkspaceDir(patientId, courseId, visitId), "attachments");
  }

  getVisitWorkspaceDir(patientId: string, courseId: string, visitId: string) {
    return path.join(this.rootDir, "patients", patientId, "courses", courseId, "visits", visitId);
  }

  getSettingsBrandingDir() {
    return path.join(this.rootDir, "settings", "branding");
  }

  saveUpload(upload: StoredAssetUpload, folderPath: string, filePrefix: string) {
    fs.mkdirSync(folderPath, { recursive: true });
    const decoded = decodeDataUrl(upload.dataUrl);
    const extension = extFromMime(upload.mimeType || decoded.mimeType, upload.name);
    const filePath = path.join(folderPath, `${sanitizeFilenamePart(filePrefix)}${extension}`);
    fs.writeFileSync(filePath, decoded.buffer);
    return filePath;
  }

  createAssetReference(filePath: string | null, kind: AssetKind): AssetReference | null {
    if (!filePath) {
      return null;
    }

    const normalizedPath = path.resolve(filePath);
    const existingAssetId = this.assetIdByPath.get(normalizedPath);
    const assetId = existingAssetId ?? `asset_${crypto.randomUUID()}`;
    this.registerAssetPath(assetId, normalizedPath);
    return { assetId, kind };
  }

  registerStoredAssetReference(asset: AssetReference, filePath: string | null): AssetReference | null {
    if (!filePath) {
      return null;
    }

    this.registerAssetPath(asset.assetId, filePath);
    return asset;
  }

  resolveAssetPath(asset: AssetReference | null) {
    if (!asset) {
      return null;
    }

    return this.resolveAssetPathById(asset.assetId);
  }

  resolveAssetPathById(assetId: string) {
    return this.pathByAssetId.get(assetId) ?? null;
  }

  private registerAssetPath(assetId: string, filePath: string) {
    const normalizedPath = path.resolve(filePath);
    this.pathByAssetId.set(assetId, normalizedPath);
    this.assetIdByPath.set(normalizedPath, assetId);
  }

  writeBinaryFile(filePath: string, data: Uint8Array) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  }

  wipeAllData() {
    this.pathByAssetId.clear();
    this.assetIdByPath.clear();
    if (fs.existsSync(this.rootDir)) {
      fs.rmSync(this.rootDir, { recursive: true, force: true });
    }
    this.initialize();
  }

  deleteFile(filePath: string) {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }

  deleteFiles(filePaths: string[]) {
    for (const filePath of filePaths) {
      this.deleteFile(filePath);
    }
  }

  directoryExists(dirPath: string) {
    return fs.existsSync(dirPath);
  }

  removeDirectory(dirPath: string) {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  ensureDirectory(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  cleanupEmptyDirectoryChain(startDir: string, stopDir: string) {
    let currentDir = startDir;
    const resolvedStopDir = path.resolve(stopDir);

    while (currentDir && path.resolve(currentDir).startsWith(resolvedStopDir) && path.resolve(currentDir) !== resolvedStopDir) {
      if (!fs.existsSync(currentDir)) {
        currentDir = path.dirname(currentDir);
        continue;
      }

      const entries = fs.readdirSync(currentDir);
      if (entries.length > 0) {
        break;
      }

      fs.rmSync(currentDir, { recursive: true, force: true });
      currentDir = path.dirname(currentDir);
    }
  }
}
