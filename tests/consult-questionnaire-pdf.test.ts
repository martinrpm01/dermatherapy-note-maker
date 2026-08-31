import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  buildConsultQuestionnairePdfFromTemplateBytes,
  createDefaultConsultQuestionnaireInput,
  fillMissingVitals
} from "../src/shared/consult-questionnaire-pdf";
import type { PatientRecord, TreatmentCourseRecord, TreatmentSiteRecord } from "../src/shared/types";

const templateBytes = fs.readFileSync(
  path.resolve(process.cwd(), "assets/templates/radiation-therapy-consult-questionnaire.pdf")
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

function buildCourse(): TreatmentCourseRecord {
  return {
    id: "course-1",
    patientId: "patient-1",
    courseName: "Rt nasal ala",
    courseType: "one_site",
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

function buildSite(): TreatmentSiteRecord {
  return {
    id: "site-1",
    courseId: "course-1",
    siteNumber: 1,
    bodyLocation: "Rt nasal ala",
    treatmentLocationText: "Rt nasal ala",
    diagnosisText: "Basal Cell Carcinoma",
    icd10: "C44.42",
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
    updatedAt: "2026-04-16T00:00:00.000Z"
  };
}

describe("consult questionnaire pdf", () => {
  it("generates one patient-named questionnaire PDF from the flat source form", async () => {
    const questionnaire = createDefaultConsultQuestionnaireInput();
    questionnaire.medicalDevices = { answer: "yes", details: "Pacemaker" };
    questionnaire.diabetes = { answer: "yes", details: "", controlled: "Yes", diabetesType: "Type 2" };
    questionnaire.vitals = {
      ...questionnaire.vitals,
      bloodPressure: "120/80",
      heartRate: "72",
      oxygenSaturation: "98"
    };

    const result = await buildConsultQuestionnairePdfFromTemplateBytes(templateBytes, {
      patient: buildPatient(),
      course: buildCourse(),
      sites: [buildSite()],
      questionnaire
    });

    const pdfDoc = await PDFDocument.load(result.bytes);
    expect(pdfDoc.getPageCount()).toBe(1);
    expect(result.fileName).toBe("John Smith - Radiation Questionaire.pdf");
    expect(result.caption).toBe("John Smith - Radiation Questionaire");
    expect(result.bytes.length).toBeGreaterThan(10_000);
  });

  it("carries questionnaire vitals into empty consult fields without replacing values already entered", () => {
    const existing = createDefaultConsultQuestionnaireInput().vitals;
    const questionnaireVitals = {
      ...existing,
      bloodPressure: "120/80",
      heartRate: "72",
      oxygenSaturation: "98"
    };
    expect(fillMissingVitals(existing, questionnaireVitals)).toMatchObject({
      bloodPressure: "120/80",
      heartRate: "72",
      oxygenSaturation: "98"
    });
    expect(fillMissingVitals({ ...existing, heartRate: "80" }, questionnaireVitals).heartRate).toBe("80");
  });
});
