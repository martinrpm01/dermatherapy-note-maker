import fs from "node:fs";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildSimWorksheetPdfFromTemplateBytes } from "../src/shared/sim-worksheet-pdf";
import type { PatientRecord, SiteSnapshot, TreatmentCourseRecord, VisitNoteRecord } from "../src/shared/types";

const templateBytes = fs.readFileSync(
  path.resolve(process.cwd(), "assets/templates/radiation-therapy-sim-worksheet.pdf")
);

function createPatient(): PatientRecord {
  return {
    id: "patient_1",
    firstName: "John",
    lastName: "Smith",
    mrn: "MRN-123",
    dob: "1942-03-01",
    sex: "Male",
    facePhoto: null,
    status: "active",
    notes: "",
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z",
    archivedAt: null
  };
}

function createCourse(courseType: TreatmentCourseRecord["courseType"]): TreatmentCourseRecord {
  return {
    id: "course_1",
    patientId: "patient_1",
    courseName: courseType === "two_site" ? "Two Site Course" : "One Site Course",
    courseType,
    prescribedFractions: 10,
    status: "active",
    startDate: "2026-04-16",
    endDate: null,
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z",
    archivedAt: null
  };
}

function createSiteSnapshot(siteNumber: 1 | 2, overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
  return {
    siteNumber,
    bodyLocation: siteNumber === 1 ? "Lt foot" : "Rt foot",
    treatmentLocationText: siteNumber === 1 ? "Lt foot" : "Rt foot",
    diagnosisText: siteNumber === 1 ? "Basal Cell Carcinoma" : "Squamous Cell Carcinoma",
    biopsyDate: "2026-04-10",
    icd10: siteNumber === 1 ? "C44.42" : "C31",
    numberOfBlocks: 1,
    lesionSize: siteNumber === 1 ? "5mm" : "8mm",
    treatmentDepth: "3 mm",
    coneSize: "20mm",
    cutoutSize: siteNumber === 1 ? "15mm" : "18mm",
    shields: "",
    machine: "Xoft Elekta 1200 SPX",
    energyKv: "50kV",
    treatmentInterval: "bi-weekly",
    additionalDevices: "",
    worksheetSide: siteNumber === 1 ? "Left" : "Right",
    worksheetPositioning: "Supine",
    worksheetVacLokArea: "NA",
    worksheetEyeShieldType: "None",
    worksheetGumShieldPosition: "None",
    worksheetLipShieldPosition: "None",
    dailyDose: 400,
    totalDose: 4000,
    cumulativeDose: 0,
    prescribedFractions: 10,
    ...overrides
  };
}

function createVisit(siteSnapshots: SiteSnapshot[]): VisitNoteRecord {
  return {
    id: "visit_1",
    patientId: "patient_1",
    courseId: "course_1",
    visitDate: "2026-04-16",
    noteType: "consult_sim",
    treatmentNumber: null,
    status: "draft",
    therapistName: "Martin Roman",
    vitals: {
      bloodPressure: "",
      heartRate: "",
      oxygenSaturation: "",
      weight: ""
    },
    structuredFields: {
      chiefComplaint: "",
      additionalNotes: "Test note",
      finalTreatment: false,
      prescribedFractionsInput: null,
      projectedFractionsInput: 10,
      biopsyDate: "2026-04-10",
      lastTreatmentDate: "",
      focusedExam: "",
      healingDescription: "",
      examComment: "",
      impressionPlanComments: "",
      postCare: "",
      followUp: "",
      simulationComplications: "",
      treatmentComment: "",
      physicsComment: "",
      consultReview: "",
      treatmentOptions: "",
      risksAndBenefits: "",
      additionalInformation: "",
      otherInstructions: "",
      supervisedBy: "",
      startRadiationDate: "",
      ultrasoundPerformed: "",
      addMips: false,
      siteSnapshots
    },
    generatedText: "",
    editedText: "",
    pdfAsset: null,
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z"
  };
}

describe("buildSimWorksheetPdfFromTemplateBytes", () => {
  it("builds a loadable worksheet PDF for a one-lesion consult", async () => {
    const worksheet = await buildSimWorksheetPdfFromTemplateBytes(templateBytes, {
      patient: createPatient(),
      course: createCourse("one_site"),
      visit: createVisit([createSiteSnapshot(1, { additionalDevices: "Eye Shield", worksheetEyeShieldType: "External" })])
    });

    expect(worksheet.fileName).toBe("John Smith - Sim Worksheet.pdf");
    expect(worksheet.caption).toBe("John Smith - Sim Worksheet");

    const pdfDoc = await PDFDocument.load(worksheet.bytes);
    expect(pdfDoc.getPageCount()).toBe(1);
  });

  it("builds a loadable worksheet PDF for a two-lesion consult", async () => {
    const worksheet = await buildSimWorksheetPdfFromTemplateBytes(templateBytes, {
      patient: createPatient(),
      course: createCourse("two_site"),
      visit: createVisit([
        createSiteSnapshot(1, { additionalDevices: "Eye Shield", worksheetEyeShieldType: "External" }),
        createSiteSnapshot(2, { additionalDevices: "Lip Shield", worksheetLipShieldPosition: "Upper" })
      ])
    });

    const pdfDoc = await PDFDocument.load(worksheet.bytes);
    expect(pdfDoc.getPageCount()).toBe(1);
  });
});
