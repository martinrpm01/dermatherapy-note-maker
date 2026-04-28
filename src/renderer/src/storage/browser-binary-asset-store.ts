import type { AssetKind, AssetReference, StoredAssetUpload } from "../../../shared/types";
import type { BinaryAssetStore } from "../../../shared/storage";

type BrowserAssetRecord = {
  assetId: string;
  kind: AssetKind;
  filePath: string;
  blob: Blob;
};

type BrowserBinaryStoreName = "assets";

const DATABASE_NAME = "dermatherapy-note-maker-browser-assets";
const DATABASE_VERSION = 1;

function makeAssetId() {
  return `asset_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function decodeDataUrl(dataUrl: string) {
  const [, mimeType = "application/octet-stream", encoded = ""] =
    dataUrl.match(/^data:(.+?);base64,(.+)$/) || [];
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { mimeType, bytes };
}

function extractAssetIdFromBrowserPath(filePath: string) {
  const match = filePath.match(/^browser-asset:\/\/([^/]+)(?:\/.*)?$/);
  return match?.[1] ?? null;
}

function sanitizeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

export class BrowserBinaryAssetStore implements BinaryAssetStore {
  readonly rootDir = "browser://dermatherapy-note-maker/assets";

  private dbPromise: Promise<IDBDatabase> | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingWrites: Promise<void> = Promise.resolve();
  private readonly pathByAssetId = new Map<string, string>();
  private readonly assetIdByPath = new Map<string, string>();
  private readonly blobByAssetId = new Map<string, Blob>();
  private readonly objectUrlByAssetId = new Map<string, string>();
  private readonly knownDirectories = new Set<string>();

  initialize() {
    if (!this.readyPromise) {
      this.readyPromise = this.loadPersistedAssets();
    }
  }

  async ready() {
    this.initialize();
    await this.readyPromise;
  }

  async flush() {
    await this.ready();
    await this.pendingWrites;
  }

  async wipeAllData() {
    await this.flush();
    this.dispose();
    this.pathByAssetId.clear();
    this.assetIdByPath.clear();
    this.blobByAssetId.clear();
    this.knownDirectories.clear();

    const db = this.dbPromise ? await this.dbPromise : null;
    if (db) {
      db.close();
    }

    await this.deleteDatabase();
    this.dbPromise = null;
    this.readyPromise = null;
    this.pendingWrites = Promise.resolve();
  }

  getPatientProfileDir(patientId: string) {
    return `${this.rootDir}/patients/${encodeURIComponent(patientId)}/profile`;
  }

  getCourseDocumentsDir(patientId: string, courseId: string) {
    return `${this.rootDir}/patients/${encodeURIComponent(patientId)}/courses/${encodeURIComponent(courseId)}/documents`;
  }

  getDocumentOnlyFilesDir(recordId: string) {
    return `${this.rootDir}/document-only/${encodeURIComponent(recordId)}/files`;
  }

  getVisitPhotosDir(patientId: string, courseId: string, visitId: string) {
    return `${this.getVisitWorkspaceDir(patientId, courseId, visitId)}/photos`;
  }

  getVisitAttachmentsDir(patientId: string, courseId: string, visitId: string) {
    return `${this.getVisitWorkspaceDir(patientId, courseId, visitId)}/attachments`;
  }

  getVisitWorkspaceDir(patientId: string, courseId: string, visitId: string) {
    return `${this.rootDir}/patients/${encodeURIComponent(patientId)}/courses/${encodeURIComponent(courseId)}/visits/${encodeURIComponent(visitId)}`;
  }

  getSettingsBrandingDir() {
    return `${this.rootDir}/settings/branding`;
  }

  saveUpload(upload: StoredAssetUpload, folderPath: string, filePrefix: string) {
    const decoded = decodeDataUrl(upload.dataUrl);
    const assetId = makeAssetId();
    const extension = upload.name.includes(".") ? upload.name.slice(upload.name.lastIndexOf(".")) : this.extensionForMime(decoded.mimeType);
    const filePath = this.buildFilePath(assetId, folderPath, `${sanitizeSegment(filePrefix)}${extension}`);
    this.writeAssetBlobInternal({ assetId, kind: "visit_attachment", filePath, blob: new Blob([decoded.bytes], { type: decoded.mimeType }) });
    return filePath;
  }

  createAssetReference(filePath: string | null, kind: AssetKind): AssetReference | null {
    if (!filePath) {
      return null;
    }

    const existingAssetId = extractAssetIdFromBrowserPath(filePath) ?? this.assetIdByPath.get(filePath);
    const assetId = existingAssetId ?? makeAssetId();
    this.registerPath(assetId, filePath);
    return { assetId, kind };
  }

  registerStoredAssetReference(asset: AssetReference, filePath: string, blob: Blob) {
    this.writeAssetBlobInternal({ assetId: asset.assetId, kind: asset.kind, filePath, blob });
    return asset;
  }

  resolveAssetUrl(asset: AssetReference | null) {
    if (!asset) {
      return null;
    }
    return this.resolveAssetPathById(asset.assetId);
  }

  getStoredBlob(assetId: string) {
    return this.blobByAssetId.get(assetId) ?? null;
  }

  getStoredPath(assetId: string) {
    return this.pathByAssetId.get(assetId) ?? null;
  }

  resolveAssetPath(asset: AssetReference | null) {
    if (!asset) {
      return null;
    }
    return this.resolveAssetPathById(asset.assetId);
  }

  resolveAssetPathById(assetId: string) {
    return this.objectUrlByAssetId.get(assetId) ?? null;
  }

  resolveNamedAssetUrl(assetId: string, fileName: string) {
    return `/browser-assets/${encodeURIComponent(assetId)}/${encodeURIComponent(fileName)}`;
  }

  writeBinaryFile(filePath: string, data: Uint8Array) {
    const assetId = extractAssetIdFromBrowserPath(filePath) ?? this.assetIdByPath.get(filePath) ?? makeAssetId();
    this.writeAssetBlobInternal({
      assetId,
      kind: "generated_pdf",
      filePath,
      blob: new Blob([Uint8Array.from(data).buffer], { type: "application/octet-stream" })
    });
  }

  deleteFile(filePath: string) {
    const assetId = extractAssetIdFromBrowserPath(filePath) ?? this.assetIdByPath.get(filePath);
    if (!assetId) {
      return;
    }

    const resolvedPath = this.pathByAssetId.get(assetId);
    if (resolvedPath) {
      this.assetIdByPath.delete(resolvedPath);
    }
    this.pathByAssetId.delete(assetId);
    this.blobByAssetId.delete(assetId);
    this.revokeObjectUrl(assetId);

    this.pendingWrites = this.pendingWrites.then(async () => {
      const db = await this.getDb();
      await this.runTransaction<void>(db, "assets", "readwrite", (store) => store.delete(assetId));
    });
  }

  deleteFiles(filePaths: string[]) {
    for (const filePath of filePaths) {
      this.deleteFile(filePath);
    }
  }

  dispose() {
    for (const objectUrl of this.objectUrlByAssetId.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.objectUrlByAssetId.clear();
  }

  directoryExists(dirPath: string) {
    return this.knownDirectories.has(dirPath);
  }

  removeDirectory(dirPath: string) {
    this.knownDirectories.delete(dirPath);
  }

  ensureDirectory(dirPath: string) {
    this.knownDirectories.add(dirPath);
  }

  cleanupEmptyDirectoryChain(startDir: string, stopDir: string) {
    let currentDir = startDir;
    while (currentDir.startsWith(stopDir) && currentDir !== stopDir) {
      if ([...this.assetIdByPath.keys()].some((filePath) => filePath.startsWith(`${currentDir}/`))) {
        break;
      }
      this.knownDirectories.delete(currentDir);
      const nextSlash = currentDir.lastIndexOf("/");
      if (nextSlash <= 0) {
        break;
      }
      currentDir = currentDir.slice(0, nextSlash);
    }
  }

  private extensionForMime(mimeType: string) {
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

  private buildFilePath(assetId: string, folderPath: string, fileName: string) {
    this.ensureDirectory(folderPath);
    return `browser-asset://${assetId}/${folderPath.replace(/^browser:\/\//, "")}/${encodeURIComponent(fileName)}`;
  }

  private registerPath(assetId: string, filePath: string) {
    this.pathByAssetId.set(assetId, filePath);
    this.assetIdByPath.set(filePath, assetId);
    const browserFolder = filePath.substring(0, filePath.lastIndexOf("/"));
    if (browserFolder) {
      this.ensureDirectory(browserFolder);
    }
  }

  private writeAssetBlobInternal(record: BrowserAssetRecord) {
    this.revokeObjectUrl(record.assetId);

    this.registerPath(record.assetId, record.filePath);
    this.blobByAssetId.set(record.assetId, record.blob);
    this.objectUrlByAssetId.set(record.assetId, URL.createObjectURL(record.blob));

    this.pendingWrites = this.pendingWrites.then(async () => {
      const db = await this.getDb();
      await this.runTransaction<void>(db, "assets", "readwrite", (store) => store.put(record));
    });
  }

  private async loadPersistedAssets() {
    const db = await this.getDb();
    const records = await this.runTransaction<BrowserAssetRecord[]>(db, "assets", "readonly", (store) => store.getAll());
    for (const record of records) {
      this.registerPath(record.assetId, record.filePath);
      this.blobByAssetId.set(record.assetId, record.blob);
      this.revokeObjectUrl(record.assetId);
      this.objectUrlByAssetId.set(record.assetId, URL.createObjectURL(record.blob));
    }
  }

  private revokeObjectUrl(assetId: string) {
    const existingObjectUrl = this.objectUrlByAssetId.get(assetId);
    if (existingObjectUrl) {
      URL.revokeObjectURL(existingObjectUrl);
      this.objectUrlByAssetId.delete(assetId);
    }
  }

  private async getDb() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("assets")) {
            db.createObjectStore("assets", { keyPath: "assetId" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed for browser binary asset store."));
      });
    }

    return this.dbPromise;
  }

  private deleteDatabase() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed for browser binary asset store."));
      request.onblocked = () => reject(new Error("IndexedDB delete was blocked for browser binary asset store."));
    });
  }

  private async runTransaction<T>(
    db: IDBDatabase,
    storeName: BrowserBinaryStoreName,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<any> | void
  ) {
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const request = operation(store);

      if (request) {
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB request failed for ${storeName}.`));
      } else {
        transaction.oncomplete = () => resolve(undefined as T);
      }

      transaction.onerror = () => reject(transaction.error ?? new Error(`IndexedDB transaction failed for ${storeName}.`));
      transaction.onabort = () => reject(transaction.error ?? new Error(`IndexedDB transaction aborted for ${storeName}.`));
    });
  }
}
