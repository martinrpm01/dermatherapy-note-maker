import type { CourseType, NoteType, SiteSnapshot, Vitals, VisitNoteBundle, VisitStructuredFields } from "./types";

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  one_site: "1 Lesion",
  two_site: "2 Lesions",
  consult: "1 Lesion"
};

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  consult_sim: "Sim / Consult",
  first_fraction: "First Fraction",
  standard_treatment: "Standard Treatment",
  otv: "OTV + Physics"
};

export const MAX_TREATMENT_NUMBER = 15;
export const DEVICE_OPTIONS = [
  "Eye Shield",
  "Ear Shield",
  "Nasal Shield",
  "Gum Shield",
  "Vac-Lok",
  "Hand Ring",
  "Knee Wedge",
  "Pillow",
  "Flash Shield",
  "Lip Shield"
] as const;
export const ADDITIONAL_DEVICE_OPTIONS = [
  "Eye Shield",
  "Ear Shield",
  "Nasal Shield",
  "Gum Shield",
  "Hand Ring",
  "Knee Wedge",
  "Pillow",
  "Flash Shield",
  "Lip Shield"
] as const;
export const WORKSHEET_POSITION_OPTIONS = [
  "Supine",
  "Prone",
  "Vac-Lok",
  "Sitting in Chair",
  "Hunched Over Tx Couch"
] as const;
export const WORKSHEET_SIDE_OPTIONS = ["Left", "Right", "Medial"] as const;
export const VAC_LOK_AREA_OPTIONS = ["Head", "Leg", "Arm", "Hand", "Foot", "Ear", "Chest", "Back"] as const;
export const EYE_SHIELD_TYPE_OPTIONS = ["External", "Internal"] as const;
export const GUM_SHIELD_POSITION_OPTIONS = ["Upper", "Lower"] as const;
export const LIP_SHIELD_POSITION_OPTIONS = ["Upper", "Lower"] as const;
export const PRESCRIBED_FRACTION_DOSE_MAP: Readonly<Record<number, { dailyDose: number; totalDose: number }>> = {
  8: { dailyDose: 500, totalDose: 4000 },
  10: { dailyDose: 400, totalDose: 4000 },
  12: { dailyDose: 350, totalDose: 4200 },
  15: { dailyDose: 280, totalDose: 4200 }
};

export function clampTreatmentNumber(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  return Math.max(1, Math.min(MAX_TREATMENT_NUMBER, Math.trunc(value)));
}

export function getSuggestedNoteType(treatmentNumber: number | null): NoteType {
  if (treatmentNumber === null) {
    return "consult_sim";
  }

  const safeNumber = clampTreatmentNumber(treatmentNumber);
  if (safeNumber === 1) {
    return "first_fraction";
  }

  if (isOtvTreatmentNumber(safeNumber)) {
    return "otv";
  }

  return "standard_treatment";
}

export function getDoseValuesForFractions(fractions: number | null | undefined) {
  if (!(typeof fractions === "number" && fractions > 0)) {
    return null;
  }

  return PRESCRIBED_FRACTION_DOSE_MAP[fractions] ?? null;
}

export function applyAutomaticDoseValuesToSiteSnapshot<
  T extends {
    dailyDose: number;
    totalDose: number;
    prescribedFractions?: number | null;
    cumulativeDose?: number;
    doseManuallyAdjusted?: boolean;
  }
>(site: T, treatmentNumber: number | null, prescribedFractions = site.prescribedFractions ?? null): T {
  const mappedDoseValues = getDoseValuesForFractions(prescribedFractions);
  const shouldApplyAutomaticValues = Boolean(mappedDoseValues) && !site.doseManuallyAdjusted;
  const dailyDose = shouldApplyAutomaticValues ? mappedDoseValues!.dailyDose : site.dailyDose;
  const totalDose = shouldApplyAutomaticValues ? mappedDoseValues!.totalDose : site.totalDose;

  return {
    ...site,
    dailyDose,
    totalDose,
    ...(Object.prototype.hasOwnProperty.call(site, "cumulativeDose")
      ? { cumulativeDose: calculateCumulativeDose(dailyDose, treatmentNumber) }
      : {}),
    doseManuallyAdjusted: site.doseManuallyAdjusted ?? false
  };
}

export function isOtvTreatmentNumber(treatmentNumber: number | null): boolean {
  const safeNumber = clampTreatmentNumber(treatmentNumber);
  return safeNumber === 5 || safeNumber === 10 || safeNumber === 15;
}

export function getTemplateKey(courseType: CourseType, noteType: NoteType): string {
  const templateCourseType = courseType === "consult" ? "one_site" : courseType;
  return `${templateCourseType}:${noteType}`;
}

export function normalizeOptionValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const DEVICE_LABELS = DEVICE_OPTIONS.map((label) => ({
  normalized: normalizeOptionValue(label),
  label
})) as ReadonlyArray<{ normalized: string; label: string }>;

export function parseAdditionalDevices(value: string | null | undefined): string[] {
  const parts = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => normalizeOptionValue(part) !== "none");

  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const known of DEVICE_LABELS) {
    const match = parts.find((part) => normalizeOptionValue(part) === known.normalized);
    if (match && !seen.has(known.normalized)) {
      seen.add(known.normalized);
      ordered.push(known.label);
    }
  }

  for (const part of parts) {
    const normalized = normalizeOptionValue(part);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(part);
  }

  return ordered;
}

export function formatAdditionalDevices(value: string): string {
  const devices = parseAdditionalDevices(value);
  return devices.length ? devices.join(", ") : "None";
}

export function getCustomAdditionalDevices(value: string): string {
  return parseAdditionalDevices(value)
    .filter((device) => {
      const normalized = normalizeOptionValue(device);
      return (
        normalized !== normalizeOptionValue("Custom Shield") &&
        normalized !== normalizeOptionValue("Special Set-up") &&
        !DEVICE_OPTIONS.includes(device as typeof DEVICE_OPTIONS[number])
      );
    })
    .join(", ");
}

function hasNormalizedSelection(values: string[], target: string): boolean {
  return values.some((value) => normalizeOptionValue(value) === normalizeOptionValue(target));
}

export function normalizeVacLokPlacement(additionalDevices: string, worksheetPositioning: string) {
  const devices = parseAdditionalDevices(additionalDevices);
  const nextDevices = devices.filter((device) => normalizeOptionValue(device) !== normalizeOptionValue("Vac-Lok"));
  const nextPositioning = parseWorksheetSelection(worksheetPositioning);

  if (hasNormalizedSelection(devices, "Vac-Lok") && !hasNormalizedSelection(nextPositioning, "Vac-Lok")) {
    nextPositioning.push("Vac-Lok");
  }

  return {
    additionalDevices: nextDevices.length ? formatAdditionalDevices(nextDevices.join(", ")) : "None",
    worksheetPositioning: formatWorksheetSelection(
      WORKSHEET_POSITION_OPTIONS.filter((option) => hasNormalizedSelection(nextPositioning, option))
    )
  };
}

export function normalizeWorksheetDetailValue(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return normalizeOptionValue(trimmed) === "none" ? "" : trimmed;
}

export function normalizeVacLokAreaValue(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  const normalized = normalizeOptionValue(trimmed);
  return normalized === "na" || normalized === "n/a" || normalized === "none" ? "" : trimmed;
}

export function normalizeWorksheetDeviceDetailsForSite<
  T extends Pick<
    SiteSnapshot,
    "additionalDevices" | "worksheetEyeShieldType" | "worksheetGumShieldPosition" | "worksheetLipShieldPosition"
  >
>(site: T) {
  const devices = parseAdditionalDevices(site.additionalDevices);
  const hasDevice = (device: string) =>
    devices.some((value) => normalizeOptionValue(value) === normalizeOptionValue(device));

  return {
    worksheetEyeShieldType: hasDevice("Eye Shield") ? normalizeWorksheetDetailValue(site.worksheetEyeShieldType) : "",
    worksheetGumShieldPosition: hasDevice("Gum Shield")
      ? normalizeWorksheetDetailValue(site.worksheetGumShieldPosition)
      : "",
    worksheetLipShieldPosition: hasDevice("Lip Shield")
      ? normalizeWorksheetDetailValue(site.worksheetLipShieldPosition)
      : ""
  };
}

export function siteHasVacLok(site: Pick<SiteSnapshot, "additionalDevices" | "worksheetPositioning">): boolean {
  return (
    hasNormalizedSelection(parseWorksheetSelection(site.worksheetPositioning), "Vac-Lok") ||
    hasNormalizedSelection(parseAdditionalDevices(site.additionalDevices), "Vac-Lok")
  );
}

export function formatAdditionalDevicesForSite(site: Pick<
  SiteSnapshot,
  | "additionalDevices"
  | "worksheetPositioning"
  | "worksheetVacLokArea"
  | "worksheetEyeShieldType"
  | "worksheetGumShieldPosition"
  | "worksheetLipShieldPosition"
>): string {
  const devices = parseAdditionalDevices(site.additionalDevices).filter(
    (device) => normalizeOptionValue(device) !== normalizeOptionValue("Vac-Lok")
  );
  if (siteHasVacLok(site)) {
    const vacLokArea = normalizeVacLokAreaValue(site.worksheetVacLokArea);
    devices.push(vacLokArea ? `Vac-Lok - ${vacLokArea}` : "Vac-Lok");
  }
  if (!devices.length) {
    return "None";
  }

  const eyeShieldType = normalizeWorksheetDetailValue(site.worksheetEyeShieldType);
  const gumShieldPosition = normalizeWorksheetDetailValue(site.worksheetGumShieldPosition);
  const lipShieldPosition = normalizeWorksheetDetailValue(site.worksheetLipShieldPosition);

  return devices
    .map((device) => {
      const normalized = normalizeOptionValue(device);
      if (
        normalized === normalizeOptionValue("Custom Shield") ||
        normalized === normalizeOptionValue("Special Set-up")
      ) {
        return "";
      }
      if (normalized === "vac-lok" || normalized.startsWith("vac-lok - ")) {
        return device;
      }
      if (normalized === "eye shield" && eyeShieldType) {
        return `Eye Shield - ${eyeShieldType}`;
      }
      if (normalized === "gum shield" && gumShieldPosition) {
        return `Gum Shield - ${gumShieldPosition}`;
      }
      if (normalized === "lip shield" && lipShieldPosition) {
        return `Lip Shield - ${lipShieldPosition}`;
      }
      if (!DEVICE_OPTIONS.some((option) => normalizeOptionValue(option) === normalized)) {
        return `Special Set-up - ${device}`;
      }
      return device;
    })
    .filter(Boolean)
    .join(", ");
}

export function parseWorksheetSelection(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      return normalizeOptionValue(trimmed) === normalizeOptionValue("Sitting in Chair, Hunched Over Tx Couch")
        ? "Hunched Over Tx Couch"
        : trimmed;
    })
    .filter(Boolean)
    .filter((part, index, all) => all.findIndex((candidate) => normalizeOptionValue(candidate) === normalizeOptionValue(part)) === index);
}

export function formatWorksheetSelection(values: string[]): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((candidate) => normalizeOptionValue(candidate) === normalizeOptionValue(value)) === index)
    .join(", ");
}

export function buildShieldSummary(shields: string, additionalDevices: string): string {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const pushShield = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const normalized = normalizeOptionValue(trimmed);
    if (!normalized || normalized === "none") {
      return;
    }

    const label =
      normalized === "eye shield"
        ? "eye shield"
        : normalized === "ear shield"
          ? "ear shield"
          : trimmed;
    const key = normalizeOptionValue(label);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    ordered.push(label);
  };

  shields
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach(pushShield);

  parseAdditionalDevices(additionalDevices)
    .filter((device) => normalizeOptionValue(device) !== normalizeOptionValue("Vac-Lok"))
    .forEach(pushShield);

  return ordered.length ? ordered.join(", ") : "none";
}

export function normalizeCutoutSizeLabel(value: string): string {
  const normalized = normalizeOptionValue(value);
  if (!normalized || normalized === "none" || normalized === "open cone") {
    return "Open Cone";
  }

  return value.trim();
}

export function getAutoNumberOfBlocks(noteType: NoteType, cutoutSize: string): number {
  if (noteType === "consult_sim") {
    return 1;
  }

  const normalized = normalizeOptionValue(cutoutSize);
  if (!normalized || normalized === "none" || normalized === "open cone") {
    return 0;
  }

  return 1;
}

export function applyAutoNumberOfBlocks<T extends { cutoutSize: string; numberOfBlocks: number }>(
  noteType: NoteType,
  sites: T[]
): T[] {
  return sites.map((site) => ({
    ...site,
    numberOfBlocks: getAutoNumberOfBlocks(noteType, site.cutoutSize)
  }));
}

export function formatDisplayDate(value: string): string {
  if (!value) {
    return "";
  }

  const parts = value.split("-");
  if (parts.length !== 3) {
    return value;
  }

  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

export function calculateAgeAtDate(dob: string, referenceDate: string): number | "" {
  if (!dob || !referenceDate) {
    return "";
  }

  const birth = new Date(`${dob}T00:00:00`);
  const reference = new Date(`${referenceDate}T00:00:00`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) {
    return "";
  }

  let age = reference.getFullYear() - birth.getFullYear();
  const hasHadBirthday =
    reference.getMonth() > birth.getMonth() ||
    (reference.getMonth() === birth.getMonth() && reference.getDate() >= birth.getDate());

  if (!hasHadBirthday) {
    age -= 1;
  }

  return age >= 0 ? age : "";
}

export function createEmptyVitals(): Vitals {
  return {
    bloodPressure: "",
    heartRate: "",
    oxygenSaturation: "",
    weight: ""
  };
}

function normalizeVitalsWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeVitalUnit(value: string, unit: string, trailingUnitPattern: RegExp): string {
  const trimmed = normalizeVitalsWhitespace(value);
  if (!trimmed) {
    return "";
  }

  const withoutTrailingUnit = trimmed.replace(trailingUnitPattern, "").trim();
  return withoutTrailingUnit ? `${withoutTrailingUnit} ${unit}` : "";
}

export function formatBloodPressure(value: string): string {
  return normalizeVitalUnit(value, "mmHg", /(?:\s*(?:mm\s*hg|mm\s*gh))+$/i);
}

export function formatHeartRate(value: string): string {
  return normalizeVitalUnit(value, "BPM", /(?:\s*bpm)+$/i);
}

export function formatOxygenSaturation(value: string): string {
  const trimmed = normalizeVitalsWhitespace(value);
  if (!trimmed) {
    return "";
  }

  const withoutPercent = trimmed.replace(/\s*%+\s*$/g, "").trim();
  return withoutPercent ? `${withoutPercent}%` : "";
}

export function formatWeight(value: string): string {
  return normalizeVitalUnit(value, "lbs", /(?:\s*lbs?)+$/i);
}

export function formatVitals(vitals: Vitals): Vitals {
  return {
    bloodPressure: formatBloodPressure(vitals.bloodPressure),
    heartRate: formatHeartRate(vitals.heartRate),
    oxygenSaturation: formatOxygenSaturation(vitals.oxygenSaturation),
    weight: formatWeight(vitals.weight)
  };
}

export function calculateCumulativeDose(dailyDose: number, treatmentNumber: number | null): number {
  if (!treatmentNumber) {
    return 0;
  }

  return dailyDose * treatmentNumber;
}

export function getCurrentFraction(visits: VisitNoteBundle[]): number {
  return visits.reduce((highest, visitBundle) => {
    const treatmentNumber = visitBundle.note.treatmentNumber ?? 0;
    return treatmentNumber > highest ? treatmentNumber : highest;
  }, 0);
}

export function getNextTreatmentNumber(visits: VisitNoteBundle[]): number | null {
  const current = getCurrentFraction(visits);
  const next = current + 1;
  if (next > MAX_TREATMENT_NUMBER) {
    return null;
  }

  return next;
}

export function buildSiteSnapshots(
  sites: Array<{
    siteNumber: 1 | 2;
    bodyLocation: string;
    treatmentLocationText: string;
    diagnosisText: string;
    icd10: string;
    numberOfBlocks: number;
    lesionSize: string;
    treatmentDepth: string;
    coneSize: string;
    cutoutSize: string;
    shields: string;
    machine: string;
    energyKv: string;
    treatmentInterval: string;
    additionalDevices: string;
    worksheetSide: string;
    worksheetPositioning: string;
    worksheetVacLokArea: string;
    worksheetEyeShieldType: string;
    worksheetGumShieldPosition: string;
    worksheetLipShieldPosition: string;
    dailyDose: number;
    totalDose: number;
    prescribedFractions?: number;
  }>,
  treatmentNumber: number | null
  ): SiteSnapshot[] {
  return sites.map((site) => ({
    ...site,
    biopsyDate: "",
    cumulativeDose: calculateCumulativeDose(site.dailyDose, treatmentNumber)
  }));
}

export function getMaxSitePrescribedFractions(
  siteSnapshots: Array<{ prescribedFractions?: number | null }>
): number | null {
  const values = siteSnapshots
    .map((site) => site.prescribedFractions ?? null)
    .filter((value): value is number => typeof value === "number" && value > 0);

  return values.length > 0 ? Math.max(...values) : null;
}

export function fillMissingSitePrescribedFractions<
  T extends { prescribedFractions?: number | null }
>(
  siteSnapshots: T[],
  fallbackPrescribedFractions: number | null
): T[] {
  if (!(fallbackPrescribedFractions && fallbackPrescribedFractions > 0)) {
    return siteSnapshots;
  }

  return siteSnapshots.map((site) =>
    site.prescribedFractions && site.prescribedFractions > 0
      ? site
      : {
          ...site,
          prescribedFractions: fallbackPrescribedFractions
        }
  );
}

export function refreshVisitSiteSnapshots(
  noteType: NoteType,
  sites: Array<{
    siteNumber: 1 | 2;
    bodyLocation: string;
    treatmentLocationText: string;
    diagnosisText: string;
    icd10: string;
    numberOfBlocks: number;
    lesionSize: string;
    treatmentDepth: string;
    coneSize: string;
    cutoutSize: string;
    shields: string;
    machine: string;
    energyKv: string;
    treatmentInterval: string;
    additionalDevices: string;
    worksheetSide: string;
    worksheetPositioning: string;
    worksheetVacLokArea: string;
    worksheetEyeShieldType: string;
    worksheetGumShieldPosition: string;
    worksheetLipShieldPosition: string;
    dailyDose: number;
    totalDose: number;
    prescribedFractions?: number;
  }>,
  treatmentNumber: number | null,
  existingSiteSnapshots: SiteSnapshot[],
  fallbackBiopsyDate = ""
): SiteSnapshot[] {
  const latestSnapshots = buildSiteSnapshots(sites, treatmentNumber);
  return applyAutoNumberOfBlocks(
    noteType,
    latestSnapshots.map((site) => {
      const existingSnapshot = existingSiteSnapshots.find((snapshot) => snapshot.siteNumber === site.siteNumber);
      const doseManuallyAdjusted = Boolean(existingSnapshot?.doseManuallyAdjusted);
      const dailyDose = doseManuallyAdjusted ? existingSnapshot?.dailyDose ?? site.dailyDose : site.dailyDose;
      const totalDose = doseManuallyAdjusted ? existingSnapshot?.totalDose ?? site.totalDose : site.totalDose;
      return {
        ...site,
        biopsyDate: existingSnapshot?.biopsyDate || fallbackBiopsyDate || "",
        dailyDose,
        totalDose,
        cumulativeDose: calculateCumulativeDose(dailyDose, treatmentNumber),
        prescribedFractions: existingSnapshot?.prescribedFractions ?? site.prescribedFractions,
        doseManuallyAdjusted
      };
    })
  );
}

export function buildSuggestedChiefComplaint(
  noteType: NoteType,
  siteSnapshots: SiteSnapshot[],
  visitDate: string
): string {
  const diagnosisSummary =
    siteSnapshots
      .map((site) => site.diagnosisText.trim() || site.bodyLocation.trim())
      .filter(Boolean)
      .join(" / ") || "skin lesion";

  const prefix = noteType === "consult_sim" ? "Consult" : "F/U";
  return `1. ${prefix} ${diagnosisSummary} evaluated on ${formatDisplayDate(visitDate)}`.trim();
}

export function buildSimulationComplicationText(additionalDevices: string): string {
  const devices = parseAdditionalDevices(additionalDevices);
  if (!devices.length) {
    return "";
  }

  const normalizedDevices = devices.map((device) => normalizeOptionValue(device));
  const hasEye = normalizedDevices.includes("eye shield");
  const hasEar = normalizedDevices.includes("ear shield");

  const parts: string[] = [];
  if (hasEye && hasEar) {
    parts.push("Proximity to eye and ear (shielding vital organ)");
  } else if (hasEye) {
    parts.push("Proximity to eye (shielding vital organ)");
  } else if (hasEar) {
    parts.push("Proximity to ear (shielding vital organ)");
  }

  return parts.join(", ");
}

export function buildSimulationComplicationLine(additionalDevices: string): string {
  const text = buildSimulationComplicationText(additionalDevices);
  return text ? `The simulation was complicated by the following factors: ${text}` : "";
}

export function getDefaultPhysicsComment(noteType: NoteType): string {
  return noteType === "otv"
    ? 'In accordance with the standard of care for radiotherapy treatment, a review of care following every 5th fraction was performed by a medical physicist for the patient. The medical physicist reviewed the treatment documentation and parameters, clinical photos of the treatment set-up, the treatment prescription, any prescription changes, that the dose calculation was correct, that the fractional dose was charted correctly, that elapsed days and treatment days were charted correctly, that the cumulative dose is correct, and that the radiation dose administered to the patient was accurate. The medical physicist also ensured that the radiation therapy equipment was properly calibrated and is functioning effectively to ensure treatment efficacy and continued safe delivery of radiotherapy.\n\nContinued medical physics review following every 5th fraction of therapy is requested by the provider for appropriate radiotherapy management and is deemed medically necessary and a standard of care to meet state and regulatory standards.\n\nSee attached Documents within patient chart "Weekly Physics Check".'
    : "";
}

export function shouldIncludeExamVitals(noteType: NoteType, includeExamVitals: boolean | undefined): boolean {
  if (noteType !== "consult_sim" && noteType !== "otv") {
    return false;
  }

  return includeExamVitals !== false;
}

export function stripExamVitalsSection(
  renderedText: string,
  noteType: NoteType,
  includeExamVitals: boolean | undefined
): string {
  if (shouldIncludeExamVitals(noteType, includeExamVitals)) {
    return renderedText;
  }

  return renderedText.replace(
    /\nExam Vitals:\nBlood Pressure:[^\n]*\nHeart Rate:[^\n]*\nOxygen Saturation:[^\n]*\nWeight:[^\n]*\n?/,
    "\n"
  );
}

export function buildDefaultStructuredFields(
  noteType: NoteType,
  siteSnapshots: SiteSnapshot[],
  supervisingPhysician = "",
  defaults: { biopsyDate?: string; lastTreatmentDate?: string } = {}
): VisitStructuredFields {
  const normalizedSnapshots = siteSnapshots.map((site) => ({
    ...site,
    biopsyDate: site.biopsyDate || defaults.biopsyDate || ""
  }));
  const firstSiteLocation = siteSnapshots[0]?.bodyLocation || "treatment site";
  const secondSiteLocation = siteSnapshots[1]?.bodyLocation || "second treatment site";
  const combinedSiteLabel =
    siteSnapshots.length === 2 ? `${firstSiteLocation} and ${secondSiteLocation}` : firstSiteLocation;

  return {
    chiefComplaint: "",
    additionalNotes: "",
    includeExamVitals: true,
    finalTreatment: false,
    prescribedFractionsInput: null,
    projectedFractionsInput: null,
    biopsyDate: defaults.biopsyDate ?? "",
    lastTreatmentDate: defaults.lastTreatmentDate ?? "",
    focusedExam: `An exam was performed including the ${combinedSiteLabel}.`,
    healingDescription: `Appropriately healing biopsy site distributed on the ${combinedSiteLabel}.`,
    examComment:
      noteType === "otv"
        ? "Patient evaluated today during the current course of radiation therapy. Current dose reviewed. Patient reports good tolerance with no pain or new or worsening symptoms. Focused skin exam shows mild expected erythema without breakdown, ulceration, or infection. No changes required; ongoing skin care, anticipated acute effects, and the plan to continue radiation therapy as prescribed were reviewed."
        : "",
    impressionPlanComments:
      noteType === "consult_sim"
        ? "The patient has decided to proceed with radiation treatment instead of surgery due to concerns with scarring, healing, and closure.\n\nTime was spent by the physician and radiation therapist assessing and managing the patient on the date of the encounter doing the following: preparing to see the patient (eg: review of tests), obtaining and/or reviewing separately obtained history, performing a medically appropriate examination and/or evaluation, counseling and educating the patient/family/caregiver, ordering medications, tests, or procedures, referring and communicating with other health care professionals, documenting clinical information in the electronic or other health record, and care coordination.\n\nThe patient will undergo radiation therapy treatment for non-melanoma skin cancer. A simulation was medically necessary to measure the lesion and to determine the appropriate flex-shield blocking to assure adequate coverage of the target lesion while sparing normal tissue. On today's visit, following informed consent, the treatment field was demarcated, and depth measurements were performed for the radiation therapy treatment plan. Multiple clinical setup photographs were taken which will be used for the development of the prescription and treatment plan. All relevant information specifically regarding this patient's superficial skin lesion will be reviewed by a Board-Certified Radiation Oncologist, who will provide me with an advisory opinion as to treatment dose, number of fractions/ treatments, and treatment depth. I will consider his recommendation, along with all other aspects of this patient's condition, including patient's treatment preference, other comorbidities, and move forward with this patient's care.\n\nThis plan will be the initial intent for treatment. The final approved plan will be determined based on what is clinically acceptable and technically feasible and reflected in the approved prescription."
        : noteType === "first_fraction"
          ? `Patient will undergo hypo-fractionated external beam radiation therapy with curative intent for the treatment of ${combinedSiteLabel} as an alternative to surgical resection or topical therapy. Following simulation, a clinical treatment plan was medically necessary to assure the target skin lesion was covered adequately and nearby healthy adjacent tissues were maximally spared. The patient will be treated to the following prescription. This will be delivered two times per week to allow normal tissue recovery in between treatments.`
          : "",
    postCare: "Aquaphor was applied to the treated area.",
    followUp:
      siteSnapshots.length === 2
        ? "As previously scheduled for both treatment sites."
        : "As previously scheduled.",
    simulationComplications: buildSimulationComplicationText(siteSnapshots[0]?.additionalDevices || ""),
    treatmentComment:
      "Treatment was initiated today per the approved prescription, reflecting the final clinical decision. The patient was treated with radiation therapy for biopsy-proven non-melanoma skin cancer.\n\nA simple simulation was performed prior to treatment to verify lesion location, applicator placement, patient positioning, and appropriate beam-modifying devices. Clinical and lesion photographs were obtained during the simulation for verification. Dosimetry calculations were completed prior to treatment to confirm appropriate dwell time for the radiation therapy source. Treatment was delivered under my supervision, treatment start and stop times have been documented.",
    physicsComment: getDefaultPhysicsComment(noteType),
    consultReview:
      "An extensive history and exam was performed with attention to the tumor size, anatomic location, duration and histologic growth pattern and the patient's overall medical status and co-morbidities.",
    treatmentOptions:
      "The various treatment options for skin cancer removal were reviewed with the patient in detail. The patient was offered surgical (Mohs, excision, malignant destruction) and non-surgical alternatives including radiation therapy and topical chemotherapy (with reduced clearance rates). Patient declined surgical intervention and requested radiation therapy.",
    risksAndBenefits:
      "The rationale for radiation therapy was explained to the patient. The risks and benefits to therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient.",
    additionalInformation: "RT(T) was the Radiation Therapist at time of visit.",
    otherInstructions:
      "See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)",
    supervisedBy: supervisingPhysician || "",
    startRadiationDate: "",
    ultrasoundPerformed: "",
    addMips: false,
    siteSnapshots: normalizedSnapshots
  };
}
