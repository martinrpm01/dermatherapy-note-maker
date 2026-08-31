import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  buildConsentFormPdfFromTemplateBytes,
  shouldIncludePregnancyAcknowledgment
} from "../src/shared/consent-form-pdf";
import type { PatientRecord, TreatmentCourseRecord, TreatmentSiteRecord } from "../src/shared/types";

const templateBytes = fs.readFileSync(
  path.resolve(process.cwd(), "assets/templates/radiation-therapy-consent-form.pdf")
);

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

async function loadForm(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getForm();
}

describe("consent form pdf", () => {
  it("fills the known pathology fields for a one-lesion consent", async () => {
    const result = await buildConsentFormPdfFromTemplateBytes(templateBytes, {
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
      ]
    });

    const form = await loadForm(result.bytes);

    expect(form.getTextField("Text Box 1").getText()).toBe("John Smith");
    expect(form.getTextField("Text Box 1_2").getText()).toBe("03/01/1942");
    expect(form.getTextField("Text Box 1_5").getText()).toBe("MRN-123");
    expect(form.getTextField("Text Box 4").getText()).toBe("04/16/2026");
    expect(form.getTextField("Text Box 4_2").getText()).toBe("04/16/2026");
    expect(form.getFields().some((field) => field.getName() === "Text Box 2")).toBe(false);
    expect(form.getTextField("Text Box 1_3").getText()).toBe("Rt nasal ala");
    expect(form.getCheckBox("Check Box 2").isChecked()).toBe(true);
    expect(form.getCheckBox("Check Box 2_2").isChecked()).toBe(false);
    expect(form.getCheckBox("Check Box 2_3").isChecked()).toBe(false);
    expect(form.getTextField("Text Box 1_4").getText() ?? "").toBe("");
    expect(form.getCheckBox("Check Box 2_4").isChecked()).toBe(false);
    expect(form.getCheckBox("Check Box 3").isChecked()).toBe(false);
    expect(form.getCheckBox("Check Box 2_5").isChecked()).toBe(false);
  });

  it("fills both lesion sections and pathology checkboxes for a two-lesion consent", async () => {
    const result = await buildConsentFormPdfFromTemplateBytes(templateBytes, {
      patient: buildPatient(),
      course: buildCourse("two_site"),
      sites: [
        buildSite({
          siteNumber: 1,
          bodyLocation: "Lt cheek",
          treatmentLocationText: "Lt cheek",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319"
        }),
        buildSite({
          id: "site-2",
          siteNumber: 2,
          bodyLocation: "Rt temple",
          treatmentLocationText: "Rt temple",
          diagnosisText: "Squamous Cell Carcinoma in-situ",
          icd10: "C44.329"
        })
      ]
    });

    const form = await loadForm(result.bytes);

    expect(form.getTextField("Text Box 1_3").getText()).toBe("Lt cheek");
    expect(form.getCheckBox("Check Box 2").isChecked()).toBe(true);
    expect(form.getTextField("Text Box 1_4").getText()).toBe("Rt temple");
    expect(form.getCheckBox("Check Box 2_4").isChecked()).toBe(false);
    expect(form.getCheckBox("Check Box 3").isChecked()).toBe(false);
    expect(form.getCheckBox("Check Box 2_5").isChecked()).toBe(true);
  });

  it("shows pregnancy acknowledgment only for a confirmed female patient under 55 on the consent date", () => {
    const courseDate = "2026-04-16";
    expect(shouldIncludePregnancyAcknowledgment({ ...buildPatient(), sex: "Female", dob: "1971-04-17" }, courseDate)).toBe(true);
    expect(shouldIncludePregnancyAcknowledgment({ ...buildPatient(), sex: "Female", dob: "1971-04-16" }, courseDate)).toBe(false);
    expect(shouldIncludePregnancyAcknowledgment({ ...buildPatient(), sex: "Male", dob: "1990-01-01" }, courseDate)).toBe(false);
    expect(shouldIncludePregnancyAcknowledgment({ ...buildPatient(), sex: "Female", dob: "" }, courseDate)).toBe(false);
  });

  it("keeps the pregnancy initials field for an eligible female patient", async () => {
    const result = await buildConsentFormPdfFromTemplateBytes(templateBytes, {
      patient: { ...buildPatient(), sex: "Female", dob: "1990-03-01" },
      course: buildCourse("one_site"),
      sites: []
    });
    const form = await loadForm(result.bytes);
    expect(form.getTextField("Text Box 2").getText() ?? "").toBe("");
  });
});
