import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { buildConsentUploadPdf } from "../src/shared/consent-form-pdf";
import type { PatientRecord, StoredAssetUpload } from "../src/shared/types";

const patient: PatientRecord = {
  id: "patient-1",
  firstName: "John",
  lastName: "Smith",
  mrn: "MRN-123",
  dob: "1942-03-01",
  sex: "Male",
  notes: "",
  facePhoto: null,
  status: "active",
  createdAt: "2026-04-16T00:00:00.000Z",
  updatedAt: "2026-04-16T00:00:00.000Z",
  archivedAt: null
};

const tinyPngUpload: StoredAssetUpload = {
  name: "scan.png",
  mimeType: "image/png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUs8AAAAASUVORK5CYII="
};

describe("consent upload pdf", () => {
  it("converts uploaded images into a pdf consent document", async () => {
    const result = await buildConsentUploadPdf(tinyPngUpload, patient);
    const pdf = await PDFDocument.load(result.bytes);

    expect(result.fileName).toBe("John Smith Radiation Consent.pdf");
    expect(result.caption).toBe("John Smith Radiation Consent");
    expect(pdf.getPageCount()).toBe(1);
  });
});
