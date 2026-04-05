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

  if (safeNumber === 5 || safeNumber === 10 || safeNumber === 15) {
    return "otv";
  }

  return "standard_treatment";
}

export function getTemplateKey(courseType: CourseType, noteType: NoteType): string {
  const templateCourseType = courseType === "consult" ? "one_site" : courseType;
  return `${templateCourseType}:${noteType}`;
}

export function normalizeOptionValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const DEVICE_LABELS = [
  { normalized: "eye shield", label: "Eye Shield" },
  { normalized: "ear shield", label: "Ear Shield" }
] as const;

export function parseAdditionalDevices(value: string): string[] {
  const parts = value
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
    dailyDose: number;
    totalDose: number;
    prescribedFractions?: number;
  }>,
  treatmentNumber: number | null
): SiteSnapshot[] {
  return sites.map((site) => ({
    ...site,
    cumulativeDose: calculateCumulativeDose(site.dailyDose, treatmentNumber)
  }));
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
  const customDevices = devices.filter((device) => {
    const normalized = normalizeOptionValue(device);
    return normalized !== "eye shield" && normalized !== "ear shield";
  });

  const parts: string[] = [];
  if (hasEye && hasEar) {
    parts.push("Proximity to eye and ear (shielding vital organ)");
  } else if (hasEye) {
    parts.push("Proximity to eye (shielding vital organ)");
  } else if (hasEar) {
    parts.push("Proximity to ear (shielding vital organ)");
  }

  if (customDevices.length) {
    parts.push(customDevices.join(", "));
  }

  return parts.join(", ");
}

export function buildSimulationComplicationLine(additionalDevices: string): string {
  const text = buildSimulationComplicationText(additionalDevices);
  return text ? `The simulation was complicated by the following factors: ${text}` : "";
}

export function buildDefaultStructuredFields(
  noteType: NoteType,
  siteSnapshots: SiteSnapshot[],
  supervisingPhysician = "",
  defaults: { biopsyDate?: string; lastTreatmentDate?: string } = {}
): VisitStructuredFields {
  const firstSiteLocation = siteSnapshots[0]?.bodyLocation || "treatment site";
  const secondSiteLocation = siteSnapshots[1]?.bodyLocation || "second treatment site";
  const combinedSiteLabel =
    siteSnapshots.length === 2 ? `${firstSiteLocation} and ${secondSiteLocation}` : firstSiteLocation;

  return {
    chiefComplaint: "",
    additionalNotes: "",
    prescribedFractionsInput: null,
    biopsyDate: defaults.biopsyDate ?? "",
    lastTreatmentDate: defaults.lastTreatmentDate ?? "",
    focusedExam:
      "An examination was performed.\nGeneral Appearance of the patient is well developed and well nourished.\nOrientation: alert and oriented x3.\nMood and affect: pleasant.",
    healingDescription: `Appropriately healing biopsy site distributed on the ${combinedSiteLabel}.`,
    examComment:
      noteType === "otv"
        ? "Patient evaluated today during the current course of radiation therapy. Current dose reviewed. Patient reports good tolerance with no pain or new or worsening symptoms. Focused skin exam shows mild expected erythema without breakdown, ulceration, or infection. No changes required; ongoing skin care, anticipated acute effects, and the plan to continue radiation therapy as prescribed were reviewed."
        : "",
    impressionPlanComments:
      noteType === "consult_sim"
        ? "The patient has decided to proceed with radiation treatment instead of surgery due to concerns with scarring, healing, and closure.\n\nTime was spent by the physician and radiation therapist assessing and managing the patient on the date of encounter doing the following: preparing to see the patient (eg: review of tests), obtaining and/or reviewing separately obtained history, performing a medically appropriate examination and/or evaluation, counseling and educating the patient, family, or caregiver, ordering medications, tests, or procedures, referring and communicating with other health care professionals, documenting clinical information in the electronic or other health record, and care coordination.\n\nThe patient will undergo radiation therapy treatment for non-melanoma skin cancer. A simulation was medically necessary to measure the lesion and to determine the appropriate flex-shield blocking to assure adequate coverage of the target lesion while sparing normal tissue. On today's visit, following informed consent, the treatment field was demarcated, and depth measurements were performed for the radiation therapy treatment plan. Multiple clinical setup photographs were taken which will be used for the development of the prescription and treatment plan. All relevant information specifically regarding this patient's superficial skin lesion will be reviewed by a Board-Certified Radiation Oncologist, who will provide me with an advisory opinion as to treatment dose, number of fractions and treatments, and treatment depth. I will consider his recommendation, along with all other aspects of this patient's condition, including patient's treatment preference, other comorbidities, and move forward with this patient's care."
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
    physicsComment:
      noteType === "otv"
        ? "In accordance with the standard of care for radiotherapy treatment, a review of care following every 5th fraction was performed by a medical physicist for the patient. The medical physicist reviewed the treatment documentation and parameters, clinical photos of the treatment set-up, the treatment prescription, any prescription changes, that the dose calculation was correct, that the fractional dose was charted correctly, that elapsed days and treatment days were charted correctly, that the cumulative dose is correct, and that the radiation dose administered to the patient was accurate. The medical physicist also ensured that the radiation therapy equipment was properly calibrated and is functioning effectively to ensure treatment efficacy and continued safe delivery of radiotherapy.\n\nContinued medical physics review following every 5th fraction of therapy is requested by the provider for appropriate radiotherapy management and is deemed medically necessary and a standard of care to meet state and regulatory standards.\n\nSee attached Documents within patient chart \"Weekly Physics Check\"."
        : "",
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
    siteSnapshots
  };
}
