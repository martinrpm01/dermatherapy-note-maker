import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { buildSignedConsentFormPdfFromTemplateBytes } from "../src/shared/consent-form-pdf";
import type { ConsentSigningInput, PatientRecord, TreatmentCourseRecord, TreatmentSiteRecord } from "../src/shared/types";

const templateBytes = fs.readFileSync(
  path.resolve(process.cwd(), "assets/templates/radiation-therapy-consent-form.pdf")
);

const SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==";

function buildPatient(): PatientRecord {
  return {
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
}

function buildCourse(courseType: TreatmentCourseRecord["courseType"]): TreatmentCourseRecord {
  return {
    id: "course-1",
    patientId: "patient-1",
    courseName: "Rt nasal ala",
    courseType,
    prescribedFractions: 0,
    status: "pending",
    startDate: "2026-04-16",
    simConsultDate: "2026-04-16",
    endDate: null,
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    archivedAt: null
  };
}

function buildSite(overrides: Partial<TreatmentSiteRecord>): TreatmentSiteRecord {
  return {
    id: `site-${overrides.siteNumber ?? 1}`,
    courseId: "course-1",
    siteNumber: 1,
    bodyLocation: "",
    treatmentLocationText: "",
    diagnosisText: "",
    icd10: "",
    numberOfBlocks: 0,
    lesionSize: "",
    treatmentDepth: "3",
    coneSize: "",
    cutoutSize: "",
    shields: "",
    machine: "Xoft Elekta 1200 SPX",
    energyKv: "50kV",
    treatmentInterval: "bi-weekly",
    additionalDevices: "",
    worksheetSide: "",
    worksheetPositioning: "",
    worksheetVacLokArea: "",
    worksheetEyeShieldType: "",
    worksheetGumShieldPosition: "",
    worksheetLipShieldPosition: "",
    dailyDose: 0,
    totalDose: 0,
    prescribedFractions: 0,
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    ...overrides
  };
}

function buildSigning(): ConsentSigningInput {
  return {
    signDate: "2026-04-16",
    patientInitials: "JS",
    patientInitialsDataUrl: SIGNATURE_DATA_URL,
    patientPrintedName: "John Smith",
    formerRadiationAcknowledged: true,
    medicalDevicesAcknowledged: true,
    patientSignatureDataUrl: SIGNATURE_DATA_URL,
    witnessPrintedName: "Martin Roman",
    witnessSignatureDataUrl: SIGNATURE_DATA_URL
  };
}

describe("signed consent pdf", () => {
  it("builds a flattened signed consent pdf", async () => {
    const result = await buildSignedConsentFormPdfFromTemplateBytes(templateBytes, {
      patient: buildPatient(),
      course: buildCourse("one_site"),
      sites: [
        buildSite({
          siteNumber: 1,
          bodyLocation: "Rt nasal ala",
          treatmentLocationText: "Rt nasal ala",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.42"
        })
      ],
      signing: buildSigning()
    });

    const pdfDoc = await PDFDocument.load(result.bytes);
    const form = pdfDoc.getForm();

    expect(result.fileName).toBe("John Smith - Consent.pdf");
    expect(pdfDoc.getPageCount()).toBeGreaterThan(0);
    expect(form.getFields()).toHaveLength(0);
  });

  it("uses drawn pregnancy initials instead of typed initials for female consent signing", async () => {
    const result = await buildSignedConsentFormPdfFromTemplateBytes(templateBytes, {
      patient: { ...buildPatient(), sex: "Female", dob: "1990-03-01" },
      course: buildCourse("one_site"),
      sites: [
        buildSite({
          siteNumber: 1,
          bodyLocation: "Rt nasal ala",
          treatmentLocationText: "Rt nasal ala",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.42"
        })
      ],
      signing: {
        ...buildSigning(),
        patientInitials: "SHOULD_NOT_RENDER",
        patientInitialsDataUrl: SIGNATURE_DATA_URL
      }
    });

    const pdfDoc = await PDFDocument.load(result.bytes);
    const form = pdfDoc.getForm();
    const rawPdf = Buffer.from(result.bytes).toString("latin1");

    expect(result.fileName).toBe("John Smith - Consent.pdf");
    expect(form.getFields()).toHaveLength(0);
    expect(rawPdf).not.toContain("SHOULD_NOT_RENDER");
  });
});
