import {
  PDFDocument,
  StandardFonts,
  type PDFCheckBox,
  type PDFDropdown,
  type PDFRadioGroup,
  type PDFTextField
} from "pdf-lib";

import {
  formatDisplayDate,
  getCustomAdditionalDevices,
  normalizeOptionValue,
  parseAdditionalDevices,
  parseWorksheetSelection,
  siteHasVacLok
} from "./note-rules";
import type { PatientRecord, SiteSnapshot, TreatmentCourseRecord, VisitNoteRecord } from "./types";

type SiteFieldMap = {
  lesionLocation: string;
  bcc: string;
  sccis: string;
  scc: string;
  fractions: string;
  depth: string;
  icd10: string;
  cone: string;
  cutout: string;
  lesionSize: string;
  left: string;
  right: string;
  medial: string;
  specialInstructions: string;
  vacLok: string;
  vacLokArea: string;
  supine: string;
  prone: string;
  sittingChair: string;
  hunchedChair: string;
  nasalShield: string;
  eyeShield: string;
  eyeShieldType: string;
  gumShield: string;
  gumShieldPosition: string;
  lipShieldPosition: string;
  handRing: string;
  kneeWedge: string;
  pillow: string;
  flashShield: string;
  lipShield: string;
  cutoutNa: string;
  cutoutCustom: string;
  cutoutStandard: string;
};

const SITE_1_FIELDS: SiteFieldMap = {
  lesionLocation: "Text Box 1",
  bcc: "unnamed2",
  sccis: "unnamed3",
  scc: "unnamed4",
  fractions: "List Box 2",
  depth: "List Box 1",
  icd10: "icd10",
  cone: "List Box 3",
  cutout: "List Box 4",
  lesionSize: "List Box 5",
  left: "unnamed5",
  right: "unnamed6",
  medial: "unnamed7",
  specialInstructions: "Text Box 2",
  vacLok: "unnamed15",
  vacLokArea: "List Box 6",
  supine: "unnamed16",
  prone: "unnamed17",
  sittingChair: "unnamed18",
  hunchedChair: "unnamed19",
  nasalShield: "unnamed0",
  eyeShield: "unnamed14",
  eyeShieldType: "List Box 8",
  gumShield: "unnamed13",
  gumShieldPosition: "List Box 9",
  lipShieldPosition: "List Box 7",
  handRing: "unnamed8",
  kneeWedge: "unnamed9",
  pillow: "unnamed10",
  flashShield: "unnamed11",
  lipShield: "unnamed12",
  cutoutNa: "unnamed40",
  cutoutCustom: "unnamed41",
  cutoutStandard: "unnamed42"
};

const SITE_2_FIELDS: SiteFieldMap = {
  lesionLocation: "Text Box 1_2",
  bcc: "unnamed22",
  sccis: "unnamed23",
  scc: "unnamed24",
  fractions: "List Box 2_2",
  depth: "List Box 1_2",
  icd10: "icd10_2",
  cone: "List Box 3_2",
  cutout: "List Box 4_2",
  lesionSize: "List Box 5_2",
  left: "unnamed25",
  right: "unnamed26",
  medial: "unnamed27",
  specialInstructions: "Text Box 2_2",
  vacLok: "unnamed32",
  vacLokArea: "List Box 6_2",
  supine: "unnamed28",
  prone: "unnamed29",
  sittingChair: "unnamed30",
  hunchedChair: "unnamed31",
  nasalShield: "unnamed1",
  eyeShield: "unnamed33",
  eyeShieldType: "List Box 8_2",
  gumShield: "unnamed34",
  gumShieldPosition: "List Box 9_2",
  lipShieldPosition: "List Box 7_2",
  handRing: "unnamed35",
  kneeWedge: "unnamed36",
  pillow: "unnamed37",
  flashShield: "unnamed38",
  lipShield: "unnamed39",
  cutoutNa: "unnamed43",
  cutoutCustom: "unnamed44",
  cutoutStandard: "unnamed45"
};

export interface SimWorksheetBuildInput {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  visit: VisitNoteRecord;
}

function sanitizeWorksheetName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim();
}

function toPathologyFlags(diagnosisText: string) {
  const normalized = normalizeOptionValue(diagnosisText);
  return {
    bcc: normalized.includes("basal"),
    sccis: normalized.includes("in-situ") || normalized.includes("in situ"),
    scc: normalized.includes("squamous") && !(normalized.includes("in-situ") || normalized.includes("in situ"))
  };
}

function toCutoutType(cutoutSize: string) {
  const normalized = normalizeOptionValue(cutoutSize);
  if (!normalized || normalized === "na" || normalized === "n/a" || normalized === "none" || normalized === "open cone") {
    return "na";
  }

  if (normalized.includes("custom")) {
    return "custom";
  }

  return "standard";
}

function toTreatmentDepthOption(treatmentDepth: string) {
  const match = treatmentDepth.match(/(\d+(?:\.\d+)?)/);
  return match ? `${match[1]}mm` : "";
}

function toLesionSizeBucket(lesionSize: string) {
  const match = lesionSize.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return "";
  }

  const value = Number(match[1]);
  if (value < 10) return "<10";
  if (value <= 15) return "10-15";
  if (value <= 20) return "16-20";
  if (value <= 25) return "21-25";
  if (value <= 30) return "26-30";
  if (value <= 35) return "31-35";
  if (value <= 40) return "36-40";
  return "41-45";
}

function buildSpecialInstructions(site: SiteSnapshot, additionalNotes: string) {
  const parts = [getCustomAdditionalDevices(site.additionalDevices), additionalNotes.trim()].filter(Boolean);
  return parts.join("\n");
}

function hasDevice(site: SiteSnapshot, device: string) {
  return parseAdditionalDevices(site.additionalDevices).some((value) => normalizeOptionValue(value) === normalizeOptionValue(device));
}

function hasPosition(site: SiteSnapshot, position: string) {
  return parseWorksheetSelection(site.worksheetPositioning).some((value) => normalizeOptionValue(value) === normalizeOptionValue(position));
}

function hasSide(site: SiteSnapshot, side: string) {
  return parseWorksheetSelection(site.worksheetSide).some((value) => normalizeOptionValue(value) === normalizeOptionValue(side));
}

function setText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  const field = form.getTextField(name) as PDFTextField;
  field.setText(value || "");
}

function setDropdown(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string, enabled = true) {
  const field = form.getDropdown(name) as PDFDropdown;
  field.clear();
  if (enabled && value && field.getOptions().includes(value)) {
    field.select(value);
  }
}

function setCheckbox(form: ReturnType<PDFDocument["getForm"]>, name: string, checked: boolean) {
  const field = form.getCheckBox(name) as PDFCheckBox;
  if (checked) {
    field.check();
  } else {
    field.uncheck();
  }
}

function setRadioYes(form: ReturnType<PDFDocument["getForm"]>, name: string, checked: boolean) {
  if (!checked) {
    return;
  }

  const field = form.getRadioGroup(name) as PDFRadioGroup;
  field.select("Yes");
}

function fillSite(
  form: ReturnType<PDFDocument["getForm"]>,
  fieldMap: SiteFieldMap,
  site: SiteSnapshot | null,
  additionalNotes: string,
  projectedFractions: number | null
) {
  if (!site) {
    return;
  }

  const pathology = toPathologyFlags(site.diagnosisText);
  setText(form, fieldMap.lesionLocation, site.treatmentLocationText || site.bodyLocation);
  setRadioYes(form, fieldMap.bcc, pathology.bcc);
  setRadioYes(form, fieldMap.sccis, pathology.sccis);
  setRadioYes(form, fieldMap.scc, pathology.scc);
  setDropdown(form, fieldMap.fractions, String(projectedFractions ?? site.prescribedFractions ?? ""));
  setDropdown(form, fieldMap.depth, toTreatmentDepthOption(site.treatmentDepth));
  setText(form, fieldMap.icd10, site.icd10);
  setDropdown(form, fieldMap.cone, site.coneSize);
  setDropdown(form, fieldMap.cutout, toCutoutType(site.cutoutSize) === "na" ? "NA" : site.cutoutSize);
  setDropdown(form, fieldMap.lesionSize, toLesionSizeBucket(site.lesionSize));
  setCheckbox(form, fieldMap.left, hasSide(site, "Left"));
  setCheckbox(form, fieldMap.right, hasSide(site, "Right"));
  setCheckbox(form, fieldMap.medial, hasSide(site, "Medial"));
  setText(form, fieldMap.specialInstructions, buildSpecialInstructions(site, additionalNotes));

  const cutoutType = toCutoutType(site.cutoutSize);
  setRadioYes(form, fieldMap.cutoutNa, cutoutType === "na");
  setRadioYes(form, fieldMap.cutoutCustom, cutoutType === "custom");
  setRadioYes(form, fieldMap.cutoutStandard, cutoutType === "standard");

  const hasVacLok = siteHasVacLok(site);
  const hasEyeShield = hasDevice(site, "Eye Shield");
  const hasGumShield = hasDevice(site, "Gum Shield");
  const hasLipShield = hasDevice(site, "Lip Shield");
  setCheckbox(form, fieldMap.vacLok, hasVacLok);
  setDropdown(form, fieldMap.vacLokArea, site.worksheetVacLokArea || "NA", hasVacLok);
  const hasHunchedChair = hasPosition(site, "Hunched Over Tx Couch");
  setCheckbox(form, fieldMap.supine, hasPosition(site, "Supine"));
  setCheckbox(form, fieldMap.prone, hasPosition(site, "Prone"));
  setCheckbox(form, fieldMap.sittingChair, hasPosition(site, "Sitting in Chair") && !hasHunchedChair);
  setCheckbox(form, fieldMap.hunchedChair, hasHunchedChair);
  setCheckbox(form, fieldMap.nasalShield, hasDevice(site, "Nasal Shield"));
  setCheckbox(form, fieldMap.eyeShield, hasEyeShield);
  setDropdown(form, fieldMap.eyeShieldType, site.worksheetEyeShieldType || "None", hasEyeShield);
  setCheckbox(form, fieldMap.gumShield, hasGumShield);
  setDropdown(form, fieldMap.gumShieldPosition, site.worksheetGumShieldPosition || "None", hasGumShield);
  setDropdown(form, fieldMap.lipShieldPosition, site.worksheetLipShieldPosition || "None", hasLipShield);
  setCheckbox(form, fieldMap.handRing, hasDevice(site, "Hand Ring"));
  setCheckbox(form, fieldMap.kneeWedge, hasDevice(site, "Knee Wedge"));
  setCheckbox(form, fieldMap.pillow, hasDevice(site, "Pillow"));
  setCheckbox(form, fieldMap.flashShield, hasDevice(site, "Flash Shield"));
  setCheckbox(form, fieldMap.lipShield, hasLipShield);
}

export async function buildSimWorksheetPdfFromTemplateBytes(
  templateBytes: Uint8Array,
  input: SimWorksheetBuildInput
) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  setText(form, "patient name", `${input.patient.firstName} ${input.patient.lastName}`.trim());
  setText(form, "Patient id", input.patient.mrn);
  setText(form, "patient DOB", formatDisplayDate(input.patient.dob));
  setText(form, "Text Box 5", input.visit.therapistName);
  setText(form, "Text Box 6", formatDisplayDate(input.visit.visitDate));

  const sites = input.visit.structuredFields.siteSnapshots
    .slice()
    .sort((left, right) => left.siteNumber - right.siteNumber);
  const projectedFractions = input.visit.structuredFields.projectedFractionsInput ?? null;
  fillSite(
    form,
    SITE_1_FIELDS,
    sites.find((site) => site.siteNumber === 1) ?? null,
    input.visit.structuredFields.additionalNotes,
    projectedFractions
  );
  fillSite(
    form,
    SITE_2_FIELDS,
    sites.find((site) => site.siteNumber === 2) ?? null,
    input.visit.structuredFields.additionalNotes,
    projectedFractions
  );

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  form.flatten();

  const bytes = await pdfDoc.save();
  const baseName = sanitizeWorksheetName(`Sim Worksheet ${input.patient.firstName} ${input.patient.lastName}`.trim()) || "Sim Worksheet";
  return {
    bytes,
    fileName: `${baseName}.pdf`,
    caption: baseName
  };
}
