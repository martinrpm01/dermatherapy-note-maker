import {
  applyAutoNumberOfBlocks,
  buildSimulationComplicationLine,
  buildSimulationComplicationText,
  calculateAgeAtDate,
  formatAdditionalDevices,
  formatDisplayDate,
  getAutoNumberOfBlocks,
  normalizeCutoutSizeLabel
} from "../../shared/note-rules";
import { renderTemplate } from "../../shared/template-engine";
import type {
  AssetReference,
  AppSettingsView,
  CourseDetail,
  CourseInput,
  PatientInput,
  PatientRecord,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  VisitInput
} from "../../shared/types";

const DEFAULT_TREATMENT_MACHINE = "Xoft Elekta 1200 SPX";
const DEFAULT_TREATMENT_DEPTH = "3";

function formatMeasurement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalized.toLowerCase() === "open cone" || normalized.toLowerCase() === "none") {
    return "Open Cone";
  }

  const mmMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return `${mmMatch[1]}mm`;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}mm`;
  }

  return normalized;
}

function getDefaultMachine(value: string) {
  return value.trim() || DEFAULT_TREATMENT_MACHINE;
}

function getDefaultTreatmentDepth(value: string) {
  return value.trim() || DEFAULT_TREATMENT_DEPTH;
}

function buildFlexShieldCutoutText(cutoutSize: string, coneSize: string) {
  const cutoutDisplay = formatMeasurement(cutoutSize);
  const coneDisplay = formatMeasurement(coneSize);
  const openCone = cutoutDisplay === "Open Cone";

  if (openCone) {
    return coneDisplay ? `Open ${coneDisplay} Cone` : "Open Cone";
  }

  if (cutoutDisplay && coneDisplay) {
    return `${cutoutDisplay}, to be used with a ${coneDisplay} cone`;
  }

  return cutoutDisplay || "";
}

export function toFileUrl(targetPath: string | null | undefined) {
  if (!targetPath) {
    return null;
  }

  if (targetPath.startsWith("file://")) {
    return targetPath;
  }

  return `file:///${targetPath.replace(/\\/g, "/")}`;
}

export function toAssetUrl(asset: AssetReference | null | undefined) {
  if (!asset) {
    return null;
  }

  return `asset://local/${asset.assetId}`;
}

export function buildVisitPreviewText(
  templates: TemplateDefinitionRecord[],
  patient: PatientRecord,
  course: TreatmentCourseRecord,
  note: VisitInput,
  settings?: AppSettingsView | null
) {
  const template = templates.find((item) => item.key === `${course.courseType}:${note.noteType}`);
  if (!template) {
    return note.editedText || note.generatedText;
  }

  const emptySite = (siteNumber: 1 | 2) => ({
    siteNumber,
    bodyLocation: "",
    treatmentLocationText: "",
    diagnosisText: "",
    icd10: "",
    numberOfBlocks: 1,
    lesionSize: "",
    treatmentDepth: DEFAULT_TREATMENT_DEPTH,
    coneSize: "",
    cutoutSize: "",
    shields: "",
    machine: DEFAULT_TREATMENT_MACHINE,
    energyKv: "",
    treatmentInterval: "",
    additionalDevices: "",
    dailyDose: 0,
    totalDose: 0,
    cumulativeDose: 0,
    prescribedFractions: undefined
  });

  const normalizedSites = applyAutoNumberOfBlocks(note.noteType, note.structuredFields.siteSnapshots);
  const site1Base = normalizedSites.find((site) => site.siteNumber === 1) || emptySite(1);
  const site2Base = normalizedSites.find((site) => site.siteNumber === 2) || emptySite(2);
  const site1 = {
    ...site1Base,
    prescribedFractions: site1Base.prescribedFractions ?? course.prescribedFractions,
    cutoutSize: normalizeCutoutSizeLabel(site1Base.cutoutSize),
    machine: getDefaultMachine(site1Base.machine),
    treatmentDepth: getDefaultTreatmentDepth(site1Base.treatmentDepth),
    coneSizeDisplay: formatMeasurement(site1Base.coneSize),
    cutoutSizeDisplay: formatMeasurement(normalizeCutoutSizeLabel(site1Base.cutoutSize)),
    flexShieldCutoutText: buildFlexShieldCutoutText(site1Base.cutoutSize, site1Base.coneSize),
    lesionSizeDisplay: formatMeasurement(site1Base.lesionSize),
    treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site1Base.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site1Base.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site1Base.additionalDevices),
      additionalDevices: formatAdditionalDevices(site1Base.additionalDevices)
    };
  const site2 = {
    ...site2Base,
    prescribedFractions: site2Base.prescribedFractions ?? course.prescribedFractions,
    cutoutSize: normalizeCutoutSizeLabel(site2Base.cutoutSize),
    machine: getDefaultMachine(site2Base.machine),
    treatmentDepth: getDefaultTreatmentDepth(site2Base.treatmentDepth),
    coneSizeDisplay: formatMeasurement(site2Base.coneSize),
    cutoutSizeDisplay: formatMeasurement(normalizeCutoutSizeLabel(site2Base.cutoutSize)),
    flexShieldCutoutText: buildFlexShieldCutoutText(site2Base.cutoutSize, site2Base.coneSize),
    lesionSizeDisplay: formatMeasurement(site2Base.lesionSize),
    treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site2Base.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site2Base.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site2Base.additionalDevices),
      additionalDevices: formatAdditionalDevices(site2Base.additionalDevices)
    };

  return renderTemplate(template.templateText, {
    patient: {
      fullName: `${patient.firstName} ${patient.lastName}`.trim(),
      mrn: patient.mrn,
      dob: formatDisplayDate(patient.dob),
      sex: patient.sex,
      sexLower: patient.sex ? patient.sex.toLowerCase() : "patient",
      age: calculateAgeAtDate(patient.dob, note.visitDate)
    },
    visit: {
      date: formatDisplayDate(note.visitDate),
      noteTypeLabel: note.noteType,
      treatmentNumber: note.treatmentNumber ?? "",
      therapistName: note.therapistName
    },
    course: {
      prescribedFractions: course.prescribedFractions
    },
    settings: {
      dermatologyOfficeName: settings?.dermatologyOfficeName ?? ""
    },
    site1,
    site2,
    vitals: note.vitals,
    structured: {
      ...note.structuredFields,
      additionalNotesSection: note.structuredFields.additionalNotes.trim()
        ? `Additional Notes:\n${note.structuredFields.additionalNotes.trim()}\n`
        : "",
      startRadiationDate: formatDisplayDate(note.structuredFields.startRadiationDate),
      biopsyDate: formatDisplayDate(note.structuredFields.biopsyDate),
      lastTreatmentDate: formatDisplayDate(note.structuredFields.lastTreatmentDate),
      mipsSection: note.structuredFields.addMips
        ? "MIPS:\nQuality measures have been documented for this encounter in accordance with Merit-based Incentive Payment System (MIPS) requirements."
        : ""
    }
  });
}

export function createEmptyPatientForm(): PatientInput {
  return {
    firstName: "",
    lastName: "",
    mrn: "",
    dob: "",
    sex: "",
    notes: ""
  };
}

export function createEmptyCourseForm(patientId: string): CourseInput {
  return {
    patientId,
    courseName: "",
    courseType: "one_site",
    prescribedFractions: 0,
    startDate: new Date().toISOString().slice(0, 10),
    sites: [
      {
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
        machine: DEFAULT_TREATMENT_MACHINE,
        energyKv: "50kV",
        treatmentInterval: "bi-weekly",
        additionalDevices: "None",
        dailyDose: 400,
        totalDose: 4000
      }
    ]
  };
}

export function createCourseFormFromDetail(courseDetail: CourseDetail): CourseInput {
  const fallback = createEmptyCourseForm(courseDetail.course.patientId);
  const fallbackSite = fallback.sites[0];
  const sites = courseDetail.sites.length
    ? courseDetail.sites.map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", site.cutoutSize),
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth?.trim() ? site.treatmentDepth : fallbackSite.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
        shields: site.shields,
        machine: site.machine?.trim() ? site.machine : fallbackSite.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose > 0 ? site.dailyDose : fallbackSite.dailyDose,
        totalDose: site.totalDose > 0 ? site.totalDose : fallbackSite.totalDose,
        prescribedFractions: site.prescribedFractions ?? courseDetail.course.prescribedFractions
      }))
    : fallback.sites;

  return {
    id: courseDetail.course.id,
    patientId: courseDetail.course.patientId,
    courseName: courseDetail.course.courseName,
    courseType: courseDetail.course.courseType,
    prescribedFractions: courseDetail.course.prescribedFractions > 0 ? courseDetail.course.prescribedFractions : 0,
    startDate: courseDetail.course.startDate,
    endDate: courseDetail.course.endDate,
    status: courseDetail.course.status,
    sites
  };
}

export async function fileToCompressedUpload(file: File, maxDimension: number, caption?: string) {
  const imageBitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(imageBitmap.width, imageBitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
  canvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create image canvas.");
  }

  context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  const mimeType = file.type || "image/jpeg";
  const quality = mimeType === "image/png" ? undefined : 0.86;
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return {
    name: file.name,
    mimeType,
    dataUrl,
    caption
  };
}

export async function fileToUpload(file: File, caption?: string) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });

  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl,
    caption
  };
}
