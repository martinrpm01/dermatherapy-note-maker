import fs from "node:fs";
import path from "node:path";

import JSZip from "jszip";

import type {
  ArchiveAssetDescriptor,
  PatientArchiveIoHandle,
  PatientArchiveExportResult,
  PreparedPatientArchiveDescription
} from "../shared/archive";
import type { BinaryAssetStore } from "../shared/storage";

function sanitizeNamePart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function exportTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export class DesktopPatientArchiveExportService {
  constructor(
    private readonly assetStore: BinaryAssetStore,
    private readonly exportRootDir: string
  ) {}

  async exportPreparedArchive(description: PreparedPatientArchiveDescription): Promise<PatientArchiveExportResult> {
    this.assetStore.ensureDirectory(this.exportRootDir);

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(description.manifest, null, 2));
    zip.file("patient.json", JSON.stringify(description.payload.patient, null, 2));
    zip.file("courses.json", JSON.stringify(description.payload.courses, null, 2));
    zip.file("sites.json", JSON.stringify(description.payload.sites, null, 2));
    zip.file("visit-notes.json", JSON.stringify(description.payload.visitNotes, null, 2));
    zip.file("visit-photos.json", JSON.stringify(description.payload.visitPhotos, null, 2));
    zip.file("visit-attachments.json", JSON.stringify(description.payload.visitAttachments, null, 2));
    zip.file("generated-pdfs.json", JSON.stringify(description.payload.generatedPdfs, null, 2));
    zip.file("asset-descriptors.json", JSON.stringify(description.assets, null, 2));
    zip.file("warnings.json", JSON.stringify(description.warnings, null, 2));

    let includedAssetCount = 0;
    for (const asset of description.assets) {
      const added = this.addAssetToZip(zip, asset);
      if (added) {
        includedAssetCount += 1;
      }
    }

    const archiveFileName = this.buildArchiveFileName(description);
    const archivePath = path.join(this.exportRootDir, archiveFileName);
    const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    this.assetStore.writeBinaryFile(archivePath, zipBytes);

    return {
      patientId: description.manifest.patientId,
      archiveHandle: this.buildArchiveHandle(archivePath, archiveFileName),
      includedAssetCount,
      missingAssetCount: description.warnings.length,
      warnings: description.warnings
    };
  }

  private addAssetToZip(zip: JSZip, descriptor: ArchiveAssetDescriptor) {
    const resolvedPath = this.assetStore.resolveAssetPath(descriptor.asset);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return false;
    }

    zip.file(descriptor.packagePath, fs.readFileSync(resolvedPath));
    return true;
  }

  private buildArchiveFileName(description: PreparedPatientArchiveDescription) {
    const identity = description.manifest.patientIdentity;
    const patientName = sanitizeNamePart(`${identity.lastName}-${identity.firstName}`) || description.manifest.patientId;
    const mrn = sanitizeNamePart(identity.mrn) || "no-mrn";
    return `${patientName}-${mrn}-patient-archive-${exportTimestamp()}.zip`;
  }

  private buildArchiveHandle(archivePath: string, archiveFileName: string): PatientArchiveIoHandle {
    return {
      kind: "desktop_path",
      path: archivePath,
      fileName: archiveFileName
    };
  }
}
