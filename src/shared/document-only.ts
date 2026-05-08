import {
  getAutoNumberOfBlocks,
  normalizeCutoutSizeLabel,
  normalizeVacLokAreaValue,
  normalizeVacLokPlacement,
  normalizeWorksheetDeviceDetailsForSite
} from "./note-rules";
import type {
  ConsentSigningInput,
  DocumentOnlyDetail,
  DocumentOnlyInput,
  DocumentOnlyRecord,
  DocumentOnlySiteInput,
  PatientRecord,
  SiteSnapshot,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  VisitInput,
  VisitStructuredFields
} from "./types";

const DEFAULT_MACHINE = "Xoft Elekta 1200 SPX";
const DEFAULT_DEPTH = "3";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function createEmptyDocumentOnlySiteInput(siteNumber: 1 | 2): DocumentOnlySiteInput {
  return {
    siteNumber,
    bodyLocation: "",
    treatmentLocationText: "",
    diagnosisText: "",
    icd10: "",
    numberOfBlocks: 1,
    lesionSize: "",
    treatmentDepth: DEFAULT_DEPTH,
    coneSize: "",
    cutoutSize: "",
    shields: "",
    machine: DEFAULT_MACHINE,
    energyKv: "50kV",
    treatmentInterval: "bi-weekly",
    additionalDevices: "None",
    worksheetSide: "",
    worksheetPositioning: "",
    worksheetVacLokArea: "",
    worksheetEyeShieldType: "",
    worksheetGumShieldPosition: "",
    worksheetLipShieldPosition: "",
    dailyDose: 0,
    totalDose: 0,
    projectedFractions: null
  };
}

export function createEmptyDocumentOnlyInput(defaultTherapist = ""): DocumentOnlyInput {
  return {
    firstName: "",
    lastName: "",
    mrn: "",
    dob: "",
    sex: "",
    therapistName: defaultTherapist,
    courseType: "one_site",
    biopsyDate: todayIso(),
    simConsultDate: todayIso(),
    sites: [createEmptyDocumentOnlySiteInput(1)]
  };
}

export function createDocumentOnlyInputFromDetail(detail: DocumentOnlyDetail): DocumentOnlyInput {
  return {
    id: detail.record.id,
    firstName: detail.record.firstName,
    lastName: detail.record.lastName,
    mrn: detail.record.mrn,
    dob: detail.record.dob,
    sex: detail.record.sex,
    therapistName: detail.record.therapistName,
    courseType: detail.record.courseType,
    biopsyDate: detail.record.biopsyDate,
    simConsultDate: detail.record.simConsultDate,
    sites: detail.sites
      .slice()
      .sort((left, right) => left.siteNumber - right.siteNumber)
      .map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        worksheetSide: site.worksheetSide,
        worksheetPositioning: site.worksheetPositioning,
        worksheetVacLokArea: site.worksheetVacLokArea,
        worksheetEyeShieldType: site.worksheetEyeShieldType,
        worksheetGumShieldPosition: site.worksheetGumShieldPosition,
        worksheetLipShieldPosition: site.worksheetLipShieldPosition,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose,
        projectedFractions: site.projectedFractions
      }))
  };
}

export function buildDocumentOnlyRecordTitle(detail: Pick<DocumentOnlyDetail, "sites"> | { sites: Array<Pick<DocumentOnlySiteInput, "treatmentLocationText">> }) {
  return detail.sites
    .map((site) => site.treatmentLocationText.trim())
    .filter(Boolean)
    .join(" + ");
}

export function buildDocumentOnlySiteSummary(record: Pick<DocumentOnlyRecord, "courseType">, sites: Array<Pick<DocumentOnlySiteInput, "treatmentLocationText">>) {
  const title = buildDocumentOnlyRecordTitle({ sites });
  return `${title || "Untitled record"} \u00b7 ${record.courseType === "two_site" ? "2-lesion" : "1-lesion"} document record`;
}

export function createDefaultDocumentOnlyConsentSigningInput(detail: DocumentOnlyDetail): ConsentSigningInput {
  return {
    signDate: detail.record.simConsultDate || todayIso(),
    patientInitials: `${detail.record.firstName.trim().charAt(0)}${detail.record.lastName.trim().charAt(0)}`.toUpperCase(),
    patientPrintedName: `${detail.record.firstName} ${detail.record.lastName}`.trim(),
    formerRadiationAcknowledged: false,
    medicalDevicesAcknowledged: false,
    patientSignatureDataUrl: "",
    witnessPrintedName: detail.record.therapistName,
    witnessSignatureDataUrl: ""
  };
}

function buildSyntheticPatient(record: DocumentOnlyRecord): PatientRecord {
  return {
    id: `doc_patient_${record.id}`,
    firstName: record.firstName,
    lastName: record.lastName,
    mrn: record.mrn,
    dob: record.dob,
    sex: record.sex,
    facePhoto: null,
    status: "active",
    notes: "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: null
  };
}

function buildSyntheticCourse(record: DocumentOnlyRecord, sites: DocumentOnlySiteRecord[]): TreatmentCourseRecord {
  const maxProjectedFractions = Math.max(
    0,
    ...sites.map((site) => site.projectedFractions ?? 0)
  );

  return {
    id: `doc_course_${record.id}`,
    patientId: `doc_patient_${record.id}`,
    courseName: buildDocumentOnlyRecordTitle({ sites }) || "Document-only course",
    courseType: record.courseType,
    prescribedFractions: maxProjectedFractions,
    status: "active",
    startDate: record.simConsultDate || todayIso(),
    simConsultDate: record.simConsultDate || null,
    endDate: null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: null
  };
}

function buildSyntheticSite(recordId: string, site: DocumentOnlySiteRecord): TreatmentSiteRecord {
  const normalizedBase = normalizeVacLokPlacement(site.additionalDevices, site.worksheetPositioning);
  const normalizedDetails = normalizeWorksheetDeviceDetailsForSite({
    additionalDevices: normalizedBase.additionalDevices,
    worksheetEyeShieldType: site.worksheetEyeShieldType,
    worksheetGumShieldPosition: site.worksheetGumShieldPosition,
    worksheetLipShieldPosition: site.worksheetLipShieldPosition
  });

  return {
    id: `doc_site_${site.id}`,
    courseId: `doc_course_${recordId}`,
    siteNumber: site.siteNumber,
    bodyLocation: site.bodyLocation,
    treatmentLocationText: site.treatmentLocationText,
    diagnosisText: site.diagnosisText,
    icd10: site.icd10,
    numberOfBlocks: getAutoNumberOfBlocks("consult_sim", site.cutoutSize),
    lesionSize: site.lesionSize,
    treatmentDepth: site.treatmentDepth || DEFAULT_DEPTH,
    coneSize: site.coneSize,
    cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
    shields: site.shields,
    machine: site.machine || DEFAULT_MACHINE,
    energyKv: site.energyKv,
    treatmentInterval: site.treatmentInterval,
    additionalDevices: normalizedBase.additionalDevices,
    worksheetSide: site.worksheetSide,
    worksheetPositioning: normalizedBase.worksheetPositioning,
    worksheetVacLokArea: normalizeVacLokAreaValue(site.worksheetVacLokArea),
    worksheetEyeShieldType: normalizedDetails.worksheetEyeShieldType,
    worksheetGumShieldPosition: normalizedDetails.worksheetGumShieldPosition,
    worksheetLipShieldPosition: normalizedDetails.worksheetLipShieldPosition,
    dailyDose: site.dailyDose,
    totalDose: site.totalDose,
    prescribedFractions: site.projectedFractions ?? undefined,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt
  };
}

function buildStructuredFields(detail: DocumentOnlyDetail, syntheticSites: TreatmentSiteRecord[]): VisitStructuredFields {
  const siteSnapshots: SiteSnapshot[] = syntheticSites.map((site) => ({
    siteNumber: site.siteNumber,
    bodyLocation: site.bodyLocation,
    treatmentLocationText: site.treatmentLocationText,
    diagnosisText: site.diagnosisText,
    biopsyDate: detail.record.biopsyDate,
    icd10: site.icd10,
    numberOfBlocks: site.numberOfBlocks,
    lesionSize: site.lesionSize,
    treatmentDepth: site.treatmentDepth,
    coneSize: site.coneSize,
    cutoutSize: site.cutoutSize,
    shields: site.shields,
    machine: site.machine,
    energyKv: site.energyKv,
    treatmentInterval: site.treatmentInterval,
    additionalDevices: site.additionalDevices,
    worksheetSide: site.worksheetSide,
    worksheetPositioning: site.worksheetPositioning,
    worksheetVacLokArea: site.worksheetVacLokArea,
    worksheetEyeShieldType: site.worksheetEyeShieldType,
    worksheetGumShieldPosition: site.worksheetGumShieldPosition,
    worksheetLipShieldPosition: site.worksheetLipShieldPosition,
    dailyDose: site.dailyDose,
    totalDose: site.totalDose,
    cumulativeDose: 0,
    prescribedFractions: site.prescribedFractions
  }));

  return {
    chiefComplaint: "",
    additionalNotes: "",
    includeExamVitals: true,
    finalTreatment: false,
    finalTreatmentNote: "",
    prescribedFractionsInput: null,
    projectedFractionsInput: Math.max(0, ...siteSnapshots.map((site) => site.prescribedFractions ?? 0)) || null,
    biopsyDate: detail.record.biopsyDate,
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
    mipsNote: "",
    siteSnapshots
  };
}

export function buildDocumentOnlySyntheticContext(detail: DocumentOnlyDetail): {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  visit: VisitInput;
} {
  const patient = buildSyntheticPatient(detail.record);
  const sites = detail.sites.map((site) => buildSyntheticSite(detail.record.id, site));
  const course = buildSyntheticCourse(detail.record, detail.sites);
  const visit: VisitInput = {
    patientId: patient.id,
    courseId: course.id,
    visitDate: detail.record.simConsultDate || todayIso(),
    noteType: "consult_sim",
    treatmentNumber: null,
    status: "draft",
    therapistName: detail.record.therapistName,
    vitals: {
      bloodPressure: "",
      heartRate: "",
      oxygenSaturation: "",
      weight: ""
    },
    structuredFields: buildStructuredFields(detail, sites),
    generatedText: "",
    editedText: "",
    newPhotoUploads: [],
    newAttachmentUploads: []
  };

  return { patient, course, sites, visit };
}
