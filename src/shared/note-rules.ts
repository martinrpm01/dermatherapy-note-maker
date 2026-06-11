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
const DEFAULT_TREATMENT_DELIVERY_MACHINE = "Xoft Elekta 1200SPX";
const DEFAULT_TREATMENT_DELIVERY_ENERGY = "50kV";
const LEGACY_VASELINE_POST_CARE = "Vaseline was applied to the treated area.";
export const PETROLATUM_POST_CARE = "Petrolatum was applied to the treated area.";
const DEFAULT_TREATMENT_COMMENT =
  "A simple simulation was performed to verify lesion location, applicator placement, patient positioning, and beam-modifying devices. Clinical and lesion photographs were obtained for verification. Dosimetry calculations were completed prior to treatment to confirm the appropriate dwell time. Treatment was delivered under my supervision.";
const LEGACY_DEFAULT_TREATMENT_COMMENT =
  "Treatment was initiated today per the approved prescription, reflecting the final clinical decision. The patient was treated with radiation therapy for biopsy-proven non-melanoma skin cancer.\n\nA simple simulation was performed prior to treatment to verify lesion location, applicator placement, patient positioning, and appropriate beam-modifying devices. Clinical and lesion photographs were obtained during the simulation for verification. Dosimetry calculations were completed prior to treatment to confirm appropriate dwell time for the radiation therapy source. Treatment was delivered under my supervision, treatment start and stop times have been documented.";

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

export function isFinalTreatmentEligible(
  treatmentNumber: number | null | undefined,
  prescribedFractions: number | null | undefined
): boolean {
  const safeTreatmentNumber = clampTreatmentNumber(treatmentNumber ?? null);
  if (safeTreatmentNumber === null || !(typeof prescribedFractions === "number" && prescribedFractions > 0)) {
    return false;
  }

  return safeTreatmentNumber === Math.trunc(prescribedFractions);
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
    pulse: "",
    oxygenSaturation: "",
    weight: ""
  };
}

function normalizeVitalsWhitespace(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeVitalUnit(value: string | null | undefined, unit: string, trailingUnitPattern: RegExp): string {
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

export function formatPulse(value: string): string {
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
    pulse: formatPulse(vitals.pulse),
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
    biopsyDate?: string;
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
    biopsyDate: site.biopsyDate ?? "",
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
        biopsyDate: existingSnapshot?.biopsyDate || site.biopsyDate || fallbackBiopsyDate || "",
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

function formatTreatmentDeliveryMachine(value: string | null | undefined) {
  const trimmed = value?.trim() || DEFAULT_TREATMENT_DELIVERY_MACHINE;
  return trimmed.replace(/\b1200\s+SPX\b/i, "1200SPX");
}

function formatTreatmentDeliveryEnergy(value: string | null | undefined) {
  const trimmed = value?.trim() || DEFAULT_TREATMENT_DELIVERY_ENERGY;
  return trimmed.replace(/\s+/g, "").replace(/kv$/i, "kV");
}

export function buildTreatmentDeliveryStatement(
  noteType: NoteType,
  sites: Array<Partial<Pick<SiteSnapshot, "bodyLocation" | "treatmentLocationText" | "diagnosisText" | "machine" | "energyKv">>>
): string {
  if (noteType === "consult_sim") {
    return "";
  }

  const activeSites = sites.filter(
    (site) => site.bodyLocation?.trim() || site.treatmentLocationText?.trim() || site.diagnosisText?.trim()
  );
  const machine = formatTreatmentDeliveryMachine(activeSites.find((site) => site.machine?.trim())?.machine);
  const energy = formatTreatmentDeliveryEnergy(activeSites.find((site) => site.energyKv?.trim())?.energyKv);
  const diagnosisPhrase =
    activeSites.length > 1 ? "biopsy-proven nonmelanoma skin cancers" : "a biopsy-proven nonmelanoma skin cancer";

  return `Treatment was delivered today per the approved prescription, reflecting the final clinical decision. The patient was treated with hypofractionated external beam radiation therapy using the ${machine} system utilizing a ${energy} x-ray source, for ${diagnosisPhrase}.`;
}

export function buildConsultFollowUp(startRadiationDate: string | null | undefined, fallbackFollowUp: string) {
  const formattedStartDate = startRadiationDate?.trim();
  if (formattedStartDate) {
    return `The patient is scheduled to start Radiation Therapy on ${formattedStartDate}`;
  }

  return fallbackFollowUp.trim() || "As previously scheduled.";
}

export function cleanupConsultFollowUp(renderedText: string, noteType: NoteType, consultFollowUp: string) {
  if (noteType !== "consult_sim") {
    return renderedText;
  }

  return renderedText.replace(
    /Follow Up:\s*The patient is scheduled to start Radiation Therapy on[ \t]*(?=\r?\n|$)/g,
    `Follow Up: ${consultFollowUp}`
  );
}

export function getDefaultPhysicsComment(noteType: NoteType): string {
  return noteType === "otv"
    ? 'In accordance with the standard of care for radiotherapy treatment, a review of care following every 5th fraction was performed by a medical physicist for the patient. The medical physicist reviewed the treatment documentation and parameters, clinical photos of the treatment set-up, the treatment prescription, any prescription changes, that the dose calculation was correct, that the fractional dose was charted correctly, that elapsed days and treatment days were charted correctly, that the cumulative dose is correct, and that the radiation dose administered to the patient was accurate. The medical physicist also ensured that the radiation therapy equipment was properly calibrated and is functioning effectively to ensure treatment efficacy and continued safe delivery of radiotherapy.\n\nContinued medical physics review following every 5th fraction of therapy is requested by the provider for appropriate radiotherapy management and is deemed medically necessary and a standard of care to meet state and regulatory standards.\n\nSee attached Documents within patient chart "Weekly chart review note".'
    : "";
}

function resolveOtvCurrentFraction(site: SiteSnapshot, treatmentNumber?: number | null) {
  if (typeof treatmentNumber === "number" && treatmentNumber > 0) {
    return Math.trunc(treatmentNumber);
  }

  if (site.dailyDose > 0 && site.cumulativeDose > 0) {
    return Math.max(1, Math.round(site.cumulativeDose / site.dailyDose));
  }

  return null;
}

function resolveOtvPrescribedFractions(site: SiteSnapshot) {
  if (site.prescribedFractions && site.prescribedFractions > 0) {
    return site.prescribedFractions;
  }

  if (site.dailyDose > 0 && site.totalDose > 0) {
    return Math.max(1, Math.round(site.totalDose / site.dailyDose));
  }

  return null;
}

function buildOtvCoursePlanSentence(siteSnapshots: SiteSnapshot[], treatmentNumber?: number | null) {
  const statuses = siteSnapshots.map((site) => {
    const location = site.treatmentLocationText || site.bodyLocation || `Lesion ${site.siteNumber}`;
    const currentFraction = resolveOtvCurrentFraction(site, treatmentNumber);
    const prescribedFractions = resolveOtvPrescribedFractions(site);
    const isFinal =
      currentFraction !== null &&
      prescribedFractions !== null &&
      prescribedFractions > 0 &&
      currentFraction >= prescribedFractions;

    return { location, isFinal };
  });
  const finalSites = statuses.filter((status) => status.isFinal);
  const continuingSites = statuses.filter((status) => !status.isFinal);

  if (statuses.length > 0 && finalSites.length === statuses.length) {
    return "No changes required; treatment completed as prescribed.";
  }

  if (finalSites.length > 0 && continuingSites.length > 0) {
    return `No changes required for the continuing treatment site(s); continue skin care and continue radiation therapy as prescribed for ${joinClinicalList(continuingSites.map((site) => site.location))}. Treatment to ${joinClinicalList(finalSites.map((site) => site.location))} has reached the prescribed final fraction.`;
  }

  return "No changes required; continue skin care and continue radiation therapy as prescribed.";
}

export function getDefaultOtvNote(siteSnapshots: SiteSnapshot[], treatmentNumber?: number | null): string {
  const siteDescriptions = siteSnapshots.map((site) => {
    const location = site.treatmentLocationText || site.bodyLocation || `Lesion ${site.siteNumber}`;
    return `${formatDiagnosisForOtv(site.diagnosisText)} of the ${location}`;
  });
  const combinedSiteLabel = joinClinicalList(siteDescriptions, "the treatment site");
  const doseSummaries = siteSnapshots
    .map((site) => {
      const currentDose =
        typeof treatmentNumber === "number" && treatmentNumber > 0 && site.dailyDose
          ? calculateCumulativeDose(site.dailyDose, treatmentNumber)
          : site.cumulativeDose;
      const totalDose = site.totalDose;
      const prescribedFractions = resolveOtvPrescribedFractions(site);
      if (!currentDose || !totalDose || !prescribedFractions || !site.dailyDose) {
        return "";
      }

      const resolvedTreatmentNumber = Math.max(1, Math.round(currentDose / site.dailyDose));
      return `${currentDose}/${totalDose} cGy in ${resolvedTreatmentNumber} of ${prescribedFractions} fractions`;
    })
    .filter(Boolean);
  const doseText = doseSummaries.length
    ? ` Current dose reviewed ${joinClinicalList(doseSummaries)}.`
    : " Current dose reviewed.";
  const coursePlanSentence = buildOtvCoursePlanSentence(siteSnapshots, treatmentNumber);

  return `Patient evaluated today during the current course of radiation therapy for ${combinedSiteLabel}.${doseText} Patient reports good tolerance with no pain or new or worsening symptoms. Focused skin exam shows mild expected erythema without breakdown, ulceration, or infection. ${coursePlanSentence}`;
}

export function isLegacyDefaultOtvNote(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.startsWith("Patient evaluated today during the current course of radiation therapy for ") &&
    normalized.includes("Patient reports good tolerance with no pain or new or worsening symptoms.") &&
    normalized.includes("Focused skin exam shows mild expected erythema without breakdown, ulceration, or infection.")
  );
}

function formatDiagnosisForOtv(value: string): string {
  const normalized = normalizeOptionValue(value);
  if (normalized.includes("basal cell")) {
    return "BCC";
  }
  if (normalized.includes("squamous cell")) {
    return "SCC";
  }
  return value.trim() || "skin cancer";
}

function joinClinicalList(values: string[], fallback = ""): string {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  if (cleanValues.length === 0) {
    return fallback;
  }
  if (cleanValues.length === 1) {
    return cleanValues[0];
  }
  if (cleanValues.length === 2) {
    return `${cleanValues[0]} and ${cleanValues[1]}`;
  }
  return `${cleanValues.slice(0, -1).join(", ")}, and ${cleanValues[cleanValues.length - 1]}`;
}

export function shouldIncludeExamVitals(noteType: NoteType, includeExamVitals: boolean | undefined): boolean {
  if (noteType !== "consult_sim" && noteType !== "otv") {
    return false;
  }

  return true;
}

export function stripExamVitalsSection(
  renderedText: string,
  noteType: NoteType,
  includeExamVitals: boolean | undefined
): string {
  const vitalsBlockPattern =
    /\nExam Vitals:\n(?:(?:Blood Pressure|Heart Rate|Pulse|Oxygen Saturation|Weight):[^\n]*\n?)+/;

  if (!shouldIncludeExamVitals(noteType, includeExamVitals)) {
    return renderedText.replace(vitalsBlockPattern, "\n");
  }

  return renderedText.replace(vitalsBlockPattern, (block) => {
    const lines = block.split(/\n/);
    const filledVitalLines = lines.filter((line) => {
      const match = line.match(/^(Blood Pressure|Heart Rate|Pulse|Oxygen Saturation|Weight):\s*(.*)$/);
      return match ? match[2].trim().length > 0 : false;
    });

    return filledVitalLines.length ? `\nExam Vitals:\n${filledVitalLines.join("\n")}\n` : "\n";
  });
}

export function getDefaultFinalTreatmentNote(): string {
  return "Patient successfully completed the prescribed course of radiation therapy. The total dose and number of fractions were delivered as planned. The patient tolerated treatment well. Post treatment instructions were provided to the patient, with follow up to occur in 4-8 weeks.";
}

export function getDefaultMipsNote(): string {
  return "Quality measures have been documented for this encounter in accordance with Merit-based Incentive Payment System (MIPS) requirements.";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanupRemovedDefaultNoteWording(renderedText: string): string {
  const treatmentConsentPattern =
    /Written consent obtained\. The risks and benefits of XRT therapy were discussed in detail\. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed\. The treatment sites? (?:was|were) clearly identified and confirmed by the patient\. The patient received XRT as outlined above\./g;
  const mipsPattern = new RegExp(
    `(?:\\r?\\n){0,2}(?:Plan: MIPS|MIPS:)\\r?\\n${escapeRegExp(getDefaultMipsNote())}(?=\\r?\\n|$)`,
    "g"
  );

  return renderedText
    .replaceAll("Total time of 45 minutes was spent", "Total time was spent")
    .replaceAll('"Weekly Physics Check"', '"Weekly chart review note"')
    .replace(treatmentConsentPattern, "The patient received XRT as outlined above.")
    .replace(mipsPattern, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function getDefaultUltrasoundNote(): string {
  return "Ultrasound Performed: An ultrasound of the lesion was performed to assess tumor extent and guide treatment selection. The images were reviewed, and radiation therapy was selected as the treatment plan.";
}

export function normalizePostCareText(value: string): string {
  return value.trim() === LEGACY_VASELINE_POST_CARE ? PETROLATUM_POST_CARE : value;
}

export function normalizeInlineSectionText(value: string): string {
  return value.replace(/^([^:\n]{1,80}:)\s*\r?\n+/, "$1 ");
}

export function normalizeTreatmentComment(value: string): string {
  return value.trim() === LEGACY_DEFAULT_TREATMENT_COMMENT ? DEFAULT_TREATMENT_COMMENT : value;
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
    finalTreatmentNote: getDefaultFinalTreatmentNote(),
    prescribedFractionsInput: null,
    projectedFractionsInput: null,
    biopsyDate: defaults.biopsyDate ?? "",
    lastTreatmentDate: defaults.lastTreatmentDate ?? "",
    focusedExam: `An exam was performed including the ${combinedSiteLabel}.`,
    healingDescription: `Appropriately healing biopsy site distributed on the ${combinedSiteLabel}.`,
    examComment: noteType === "otv" ? getDefaultOtvNote(siteSnapshots) : "",
    impressionPlanComments:
      noteType === "consult_sim"
        ? "The patient would like to proceed with radiotherapy and declines traditional surgical removal due to concerns with healing from surgery due to irreversible changes to anatomical structures.\n\nTotal time was spent by the physician and radiation therapist assessing and managing the patient on the date of the encounter doing the following: preparing to see the patient (eg: review of tests), obtaining and/or reviewing separately obtained history, performing a medically appropriate examination and/or evaluation, counseling and educating the patient/family/caregiver, ordering medications, tests, or procedures, referring and communicating with other health care professionals, documenting clinical information in the electronic or other health record, and care coordination.\n\nThe patient will undergo hypofractionated external beam radiation therapy for the treatment of non-melanoma skin cancer. A simulation was medically necessary to measure the lesion and to determine the appropriate flex shield blocking to ensure adequate coverage of the target lesion while sparing normal tissue. On today's visit, following informed consent, the treatment field was demarcated, and depth measurements were performed for the radiotherapy treatment plan. Multiple clinical setup photographs were taken which will be used for the development of the prescription and treatment plan. The radiation oncologist will provide a recommended treatment plan. Appropriate treatment devices and targeted prescriptions will be utilized pending radiation oncologist and medical physics review."
        : noteType === "first_fraction"
          ? `Patient will undergo hypofractionated external beam radiation therapy with curative intent for the treatment of ${combinedSiteLabel} as an alternative to surgical resection or topical therapy. Following simulation, a clinical treatment plan was medically necessary to ensure the target skin lesion was covered adequately and nearby healthy adjacent tissues were maximally spared. The patient will be treated to the following prescription, delivered twice weekly to allow normal tissue recovery in between treatments.`
          : "",
    postCare: "Aquaphor was applied to the treated area.",
    followUp:
      siteSnapshots.length === 2
        ? "As previously scheduled for both treatment sites."
        : "As previously scheduled.",
    simulationComplications: buildSimulationComplicationText(siteSnapshots[0]?.additionalDevices || ""),
    treatmentComment: DEFAULT_TREATMENT_COMMENT,
    physicsComment: getDefaultPhysicsComment(noteType),
    consultReview:
      "An extensive history and exam was performed with attention to the tumor size, anatomic location, duration and histologic growth pattern and the patient's overall medical status and co-morbidities.",
    treatmentOptions:
      "The various treatment options for skin cancer removal were reviewed with the patient in detail. These include MOHS surgery with its high cure rate, excisional surgery, ED&C, radiation therapy, and various topical therapies. Given the indications, tumor type, patient preferences and location, the patient has agreed to proceed with radiotherapy.",
    risksAndBenefits:
      "The rationale for radiotherapy was explained to the patient. The risks and benefits to therapy were discussed in detail including infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence. The treatment site was clearly identified and confirmed by the patient.",
    additionalInformation: "RT(T) was the Radiation Therapist at time of visit.",
    otherInstructions:
      "See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)",
    supervisedBy: supervisingPhysician || "",
    startRadiationDate: "",
    ultrasoundPerformed: "",
    addMips: false,
    mipsNote: "",
    siteSnapshots: normalizedSnapshots
  };
}

export function getStickyMipsDefaults(
  visits: VisitNoteBundle[],
  treatmentNumber: number | null
): { addMips: boolean; mipsNote: string } | null {
  const targetSequence = treatmentNumber ?? 0;
  const priorVisits = visits
    .filter((visit) => (visit.note.treatmentNumber ?? 0) < targetSequence)
    .sort((left, right) => {
      const leftTreatment = left.note.treatmentNumber ?? 0;
      const rightTreatment = right.note.treatmentNumber ?? 0;
      if (leftTreatment !== rightTreatment) {
        return leftTreatment - rightTreatment;
      }

      const dateComparison = left.note.visitDate.localeCompare(right.note.visitDate);
      if (dateComparison !== 0) {
        return dateComparison;
      }

      return left.note.createdAt.localeCompare(right.note.createdAt);
    });
  const latestPriorVisit = priorVisits.at(-1);
  if (!latestPriorVisit) {
    return null;
  }

  return {
    addMips: Boolean(latestPriorVisit.note.structuredFields.addMips),
    mipsNote: latestPriorVisit.note.structuredFields.mipsNote?.trim() || getDefaultMipsNote()
  };
}
