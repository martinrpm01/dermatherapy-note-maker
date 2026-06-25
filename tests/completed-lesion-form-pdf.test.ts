import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { buildCompletedLesionFormPdf } from "../src/shared/completed-lesion-form-pdf";
import type { PatientRecord, TreatmentCourseRecord, TreatmentSiteRecord } from "../src/shared/types";

const now = "2026-06-25T00:00:00.000Z";

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
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };
}

function buildCourse(): TreatmentCourseRecord {
  return {
    id: "course-1",
    patientId: "patient-1",
    courseName: "Rt nasal ala",
    courseType: "one_site",
    prescribedFractions: 10,
    status: "completed",
    startDate: "2026-04-16",
    simConsultDate: "2026-04-16",
    endDate: "2026-05-20",
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };
}

function buildSite(): TreatmentSiteRecord {
  return {
    id: "site-1",
    courseId: "course-1",
    siteNumber: 1,
    bodyLocation: "Right nasal ala",
    treatmentLocationText: "Right nasal ala",
    diagnosisText: "Basal Cell Carcinoma",
    icd10: "C44.311",
    numberOfBlocks: 1,
    lesionSize: "8mm",
    treatmentDepth: "3",
    coneSize: "20mm",
    cutoutSize: "12mm",
    shields: "",
    machine: "Xoft Elekta 1200 SPX",
    energyKv: "50kV",
    treatmentInterval: "bi-weekly",
    additionalDevices: "",
    worksheetSide: "Right",
    worksheetPositioning: "Supine",
    worksheetVacLokArea: "",
    worksheetEyeShieldType: "",
    worksheetGumShieldPosition: "",
    worksheetLipShieldPosition: "",
    dailyDose: 400,
    totalDose: 4000,
    prescribedFractions: 10,
    createdAt: now,
    updatedAt: now
  };
}

describe("completed lesion form pdf", () => {
  it("builds a loadable completed lesion form without requiring a patient face photo", async () => {
    const result = await buildCompletedLesionFormPdf({
      patient: buildPatient(),
      course: buildCourse(),
      sites: [buildSite()],
      photoInputs: []
    });

    const pdfDoc = await PDFDocument.load(result.bytes);
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(result.fileName).toBe("John Smith - Completed Lesion Form.pdf");
    expect(result.caption).toBe("John Smith - Completed Lesion Form");
    expect(result.bytes.length).toBeGreaterThan(2_000);
  });
});
