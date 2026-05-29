import type { CourseType, NoteType, TemplateDefinitionRecord, TemplatePlaceholderDefinition } from "./types";
import { getTemplateKey } from "./note-rules";

function insertFinalTreatmentSectionBefore(text: string, marker: string) {
  if (!text.includes(marker)) {
    return text;
  }

  const gap = marker.includes("\r\n") ? "\r\n\r\n" : "\n\n";
  return text.replace(marker, `{{structured.finalTreatmentSection}}${gap}${marker}`);
}

function removeLegacyTreatmentSimulationLines(text: string) {
  return text
    .replaceAll("\nNumber of Treatment Areas: 1", "")
    .replaceAll("\r\nNumber of Treatment Areas: 1", "")
    .replaceAll("\nNumber of Blocks: {{site1.numberOfBlocks}}", "")
    .replaceAll("\r\nNumber of Blocks: {{site1.numberOfBlocks}}", "")
    .replaceAll("\nNumber of Blocks: {{site2.numberOfBlocks}}", "")
    .replaceAll("\r\nNumber of Blocks: {{site2.numberOfBlocks}}", "")
    .replaceAll("\nType of Blocks: Simple", "")
    .replaceAll("\r\nType of Blocks: Simple", "")
    .replaceAll("\nType of Blocks: Complex", "")
    .replaceAll("\r\nType of Blocks: Complex", "");
}

function removeLegacyTreatmentParameterDuplicates(text: string) {
  return text
    .replaceAll("\nkV: {{site1.energyKv}}", "")
    .replaceAll("\r\nkV: {{site1.energyKv}}", "")
    .replaceAll("\nkV: {{site2.energyKv}}", "")
    .replaceAll("\r\nkV: {{site2.energyKv}}", "")
    .replaceAll("\nMachine: {{site1.machine}}", "")
    .replaceAll("\r\nMachine: {{site1.machine}}", "")
    .replaceAll("\nMachine: {{site2.machine}}", "")
    .replaceAll("\r\nMachine: {{site2.machine}}", "");
}

function moveTreatmentCommentUnderSimulationPlan(text: string) {
  if (!text.includes("{{structured.treatmentComment}}")) {
    return text;
  }

  const lowerLf = "\n{{structured.treatmentComment}}\n\n{{structured.additionalNotesSection}}";
  const lowerCrLf = "\r\n{{structured.treatmentComment}}\r\n\r\n{{structured.additionalNotesSection}}";
  let normalized = text.replaceAll(lowerLf, "\n{{structured.additionalNotesSection}}").replaceAll(lowerCrLf, "\r\n{{structured.additionalNotesSection}}");

  const placements = [
    {
      marker: "Plan: Therapeutic Radiation Simulation.\n{{site1.simulationComplicationsLine}}",
      replacement:
        "Plan: Therapeutic Radiation Simulation.\n{{structured.treatmentComment}}\n{{site1.simulationComplicationsLine}}"
    },
    {
      marker: "Plan: Therapeutic Radiation Simulation.\r\n{{site1.simulationComplicationsLine}}",
      replacement:
        "Plan: Therapeutic Radiation Simulation.\r\n{{structured.treatmentComment}}\r\n{{site1.simulationComplicationsLine}}"
    },
    {
      marker: "Plan: Therapeutic Radiation Simulation.\n{{site2.simulationComplicationsLine}}",
      replacement:
        "Plan: Therapeutic Radiation Simulation.\n{{structured.treatmentComment}}\n{{site2.simulationComplicationsLine}}"
    },
    {
      marker: "Plan: Therapeutic Radiation Simulation.\r\n{{site2.simulationComplicationsLine}}",
      replacement:
        "Plan: Therapeutic Radiation Simulation.\r\n{{structured.treatmentComment}}\r\n{{site2.simulationComplicationsLine}}"
    }
  ];

  for (const { marker, replacement } of placements) {
    if (!normalized.includes(marker)) {
      continue;
    }
    const beforeMarker = normalized.slice(0, normalized.indexOf(marker));
    if (beforeMarker.endsWith("{{structured.treatmentComment}}\n") || beforeMarker.endsWith("{{structured.treatmentComment}}\r\n")) {
      continue;
    }
    normalized = normalized.replaceAll(marker, replacement);
  }

  return normalized;
}

function addConsultSimulationDetailsLine(text: string, anchor: string, line: string) {
  if (text.includes(line)) {
    return text;
  }
  return text.replaceAll(anchor, `${anchor}\n${line}`);
}

function addConsultPlanLine(text: string, siteNumber: 1 | 2) {
  const line = `Lesion Size: {{site${siteNumber}.lesionSizeDisplay}}`;
  if (text.includes(line)) {
    return text;
  }
  return text
    .replaceAll(
      `Plan: Consultation for Radiotherapy.\nLocation: {{site${siteNumber}.bodyLocation}}`,
      `Plan: Consultation for Radiotherapy.\nLocation: {{site${siteNumber}.bodyLocation}}\n${line}`
    )
    .replaceAll(
      `Plan: Consultation for Radiotherapy.\r\nLocation: {{site${siteNumber}.bodyLocation}}`,
      `Plan: Consultation for Radiotherapy.\r\nLocation: {{site${siteNumber}.bodyLocation}}\r\n${line}`
    );
}

export function normalizeTemplateTextForRendering(text: string) {
  let normalized = text
    .replaceAll(
      "Follow Up: The patient is scheduled to start Radiation Therapy on {{structured.startRadiationDate}}",
      "Follow Up: {{structured.consultFollowUp}}"
    )
    .replaceAll(
      "\n{{structured.additionalNotesSection}}\n\n{{structured.finalTreatmentSection}}\n\nFollow Up:",
      "\n{{structured.additionalNotesSection}}\n\nFollow Up:"
    )
    .replaceAll(
      "\r\n{{structured.additionalNotesSection}}\r\n\r\n{{structured.finalTreatmentSection}}\r\n\r\nFollow Up:",
      "\r\n{{structured.additionalNotesSection}}\r\n\r\nFollow Up:"
    );

  normalized = removeLegacyTreatmentSimulationLines(normalized);
  normalized = removeLegacyTreatmentParameterDuplicates(normalized);
  normalized = moveTreatmentCommentUnderSimulationPlan(normalized);
  normalized = addConsultSimulationDetailsLine(
    normalized,
    "Total Fractions: {{site1.totalFractions}}",
    "Frequency: {{site1.treatmentInterval}}"
  );
  normalized = addConsultSimulationDetailsLine(
    normalized,
    "Total dose: {{site1.totalDose}} cGy",
    "Energy: {{site1.energyKv}}"
  );
  normalized = addConsultSimulationDetailsLine(
    normalized,
    "Total Fractions: {{site2.totalFractions}}",
    "Frequency: {{site2.treatmentInterval}}"
  );
  normalized = addConsultSimulationDetailsLine(
    normalized,
    "Total dose: {{site2.totalDose}} cGy",
    "Energy: {{site2.energyKv}}"
  );
  normalized = addConsultPlanLine(normalized, 1);
  normalized = addConsultPlanLine(normalized, 2);

  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam Comment:\n{{structured.examComment}}\n\nExam Vitals:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam Comment:\r\n{{structured.examComment}}\r\n\r\nExam Vitals:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam:\n{{structured.focusedExam}}\n\nImpression / Plan Comments:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam:\r\n{{structured.focusedExam}}\r\n\r\nImpression / Plan Comments:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam:\n{{structured.focusedExam}}\n\nImpression / Plan:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Exam:\r\n{{structured.focusedExam}}\r\n\r\nImpression / Plan:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Focused Exam Sites 1 & 2:\n{{structured.focusedExam}}\n\nImpression / Plan Comments:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Focused Exam Sites 1 & 2:\r\n{{structured.focusedExam}}\r\n\r\nImpression / Plan Comments:"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Focused Exam Sites 1 & 2:\n{{structured.focusedExam}}\n\n1. {{site1.diagnosisText}}"
  );
  normalized = insertFinalTreatmentSectionBefore(
    normalized,
    "Focused Exam Sites 1 & 2:\r\n{{structured.focusedExam}}\r\n\r\n1. {{site1.diagnosisText}}"
  );

  return normalized;
}

export const TEMPLATE_PLACEHOLDERS: TemplatePlaceholderDefinition[] = [
  { token: "patient.fullName", description: "Patient first and last name." },
  { token: "patient.mrn", description: "Patient medical record number." },
  { token: "patient.dob", description: "Patient date of birth." },
  { token: "patient.sex", description: "Patient sex." },
  { token: "patient.sexLower", description: "Patient sex in lowercase for narrative wording." },
  { token: "patient.age", description: "Patient age on the visit date." },
  { token: "visit.date", description: "Visit date in MM/DD/YYYY format." },
  { token: "visit.noteTypeLabel", description: "Human-readable note type." },
  { token: "visit.treatmentNumber", description: "Current treatment number, when applicable." },
  { token: "visit.therapistName", description: "Therapist documented for the visit." },
  { token: "course.prescribedFractions", description: "Total prescribed fractions for the course." },
  { token: "site1.bodyLocation", description: "Body location text for site 1." },
  { token: "site1.treatmentLocationText", description: "Treatment location text for site 1." },
  { token: "site1.txSiteName", description: "Treatment site name for site 1." },
  { token: "site1.diagnosisText", description: "Diagnosis text for site 1." },
  { token: "site1.biopsyDate", description: "Biopsy date for site 1." },
  { token: "site1.icd10", description: "ICD10 for site 1." },
  { token: "site1.numberOfBlocks", description: "Number of blocks for site 1." },
  { token: "site1.lesionSize", description: "Lesion size (mm) for site 1." },
  { token: "site1.lesionSizeDisplay", description: "Lesion size with unit formatting for site 1." },
  { token: "site1.treatmentDepth", description: "Treatment depth for site 1." },
  { token: "site1.treatmentDepthDisplay", description: "Treatment depth with unit formatting for site 1." },
  { token: "site1.coneSize", description: "Cone/applicator size for site 1." },
  { token: "site1.coneSizeDisplay", description: "Cone/applicator size with unit formatting for site 1." },
  { token: "site1.cutoutSize", description: "Cutout size for site 1." },
  { token: "site1.cutoutSizeDisplay", description: "Cutout size with unit formatting for site 1." },
  { token: "site1.flexShieldCutoutText", description: "Formatted flex shield cutout wording for site 1." },
  { token: "site1.shields", description: "Shield text for site 1." },
  { token: "site1.machine", description: "Machine text for site 1." },
  { token: "site1.energyKv", description: "Energy/kV for site 1." },
  { token: "site1.treatmentInterval", description: "Treatment interval for site 1." },
  { token: "site1.additionalDevices", description: "Additional devices for site 1." },
  { token: "site1.simulationComplicationsLine", description: "Computed simulation complication line for site 1." },
  { token: "site1.dailyDose", description: "Daily dose for site 1." },
  { token: "site1.totalDose", description: "Total target dose for site 1." },
  { token: "site1.cumulativeDose", description: "Cumulative dose to date for site 1." },
  { token: "site1.prescribedFractions", description: "Prescribed fractions for site 1." },
  { token: "site1.totalFractions", description: "Total projected or prescribed fractions for site 1." },
  { token: "site2.bodyLocation", description: "Body location text for site 2." },
  { token: "site2.treatmentLocationText", description: "Treatment location text for site 2." },
  { token: "site2.txSiteName", description: "Treatment site name for site 2." },
  { token: "site2.diagnosisText", description: "Diagnosis text for site 2." },
  { token: "site2.biopsyDate", description: "Biopsy date for site 2." },
  { token: "site2.icd10", description: "ICD10 for site 2." },
  { token: "site2.numberOfBlocks", description: "Number of blocks for site 2." },
  { token: "site2.lesionSize", description: "Lesion size (mm) for site 2." },
  { token: "site2.lesionSizeDisplay", description: "Lesion size with unit formatting for site 2." },
  { token: "site2.treatmentDepth", description: "Treatment depth for site 2." },
  { token: "site2.treatmentDepthDisplay", description: "Treatment depth with unit formatting for site 2." },
  { token: "site2.coneSize", description: "Cone/applicator size for site 2." },
  { token: "site2.coneSizeDisplay", description: "Cone/applicator size with unit formatting for site 2." },
  { token: "site2.cutoutSize", description: "Cutout size for site 2." },
  { token: "site2.cutoutSizeDisplay", description: "Cutout size with unit formatting for site 2." },
  { token: "site2.flexShieldCutoutText", description: "Formatted flex shield cutout wording for site 2." },
  { token: "site2.shields", description: "Shield text for site 2." },
  { token: "site2.machine", description: "Machine text for site 2." },
  { token: "site2.energyKv", description: "Energy/kV for site 2." },
  { token: "site2.treatmentInterval", description: "Treatment interval for site 2." },
  { token: "site2.additionalDevices", description: "Additional devices for site 2." },
  { token: "site2.simulationComplicationsLine", description: "Computed simulation complication line for site 2." },
  { token: "site2.dailyDose", description: "Daily dose for site 2." },
  { token: "site2.totalDose", description: "Total target dose for site 2." },
  { token: "site2.cumulativeDose", description: "Cumulative dose to date for site 2." },
  { token: "site2.prescribedFractions", description: "Prescribed fractions for site 2." },
  { token: "site2.totalFractions", description: "Total projected or prescribed fractions for site 2." },
  { token: "vitals.bloodPressure", description: "Documented blood pressure." },
  { token: "vitals.heartRate", description: "Documented heart rate." },
  { token: "vitals.pulse", description: "Documented pulse." },
  { token: "vitals.oxygenSaturation", description: "Documented oxygen saturation." },
  { token: "vitals.weight", description: "Documented weight." },
  { token: "structured.chiefComplaint", description: "Chief complaint wording." },
  { token: "structured.additionalNotes", description: "Additional notes wording." },
  { token: "structured.additionalNotesSection", description: "Conditional additional notes section." },
  { token: "structured.biopsyDate", description: "Biopsy date for consult-style HPI wording." },
  { token: "structured.lastTreatmentDate", description: "Last treatment date for treatment-style HPI wording." },
  { token: "structured.focusedExam", description: "Focused exam wording." },
  { token: "structured.healingDescription", description: "Healing description wording." },
  { token: "structured.examComment", description: "Exam comment wording." },
  { token: "structured.impressionPlanComments", description: "Impression/plan comments wording." },
  { token: "structured.postCare", description: "Post-care wording." },
  { token: "structured.finalTreatmentSection", description: "Final treatment completion wording." },
  { token: "structured.followUp", description: "Follow-up wording." },
  { token: "structured.consultFollowUp", description: "Consult follow-up wording with optional treatment start date." },
  { token: "structured.simulationComplications", description: "Simulation complications wording." },
  { token: "structured.treatmentComment", description: "Treatment comment wording." },
  { token: "structured.treatmentDeliveryStatement", description: "Treatment delivery wording for treatment visits." },
  { token: "structured.physicsComment", description: "Physics consultation wording." },
  { token: "structured.consultReview", description: "Consult review wording." },
  { token: "structured.treatmentOptions", description: "Treatment options wording." },
  { token: "structured.risksAndBenefits", description: "Risks and benefits wording." },
  { token: "structured.additionalInformation", description: "Additional information wording." },
  { token: "structured.otherInstructions", description: "Other instructions wording." },
  { token: "structured.supervisedBy", description: "Supervising clinician or service." },
  { token: "structured.startRadiationDate", description: "Planned treatment start date." },
  { token: "structured.ultrasoundPerformed", description: "Ultrasound wording if applicable." },
  { token: "structured.mipsSection", description: "MIPS quality measure documentation section (when Add MIPS is checked)." },
  { token: "settings.supervisingPhysician", description: "Configured supervising physician name." },
  { token: "settings.dermatologyOfficeName", description: "Configured dermatology office name." }
];

export const ALLOWED_TEMPLATE_TOKENS = new Set(TEMPLATE_PLACEHOLDERS.map((entry) => entry.token));

function buildTemplate(courseType: CourseType, noteType: NoteType, body: string): TemplateDefinitionRecord {
  const key = getTemplateKey(courseType, noteType);
  return {
    id: key,
    key,
    courseType,
    noteType,
    templateText: body.trim(),
    defaultTemplateText: body.trim(),
    active: true,
    createdAt: "",
    updatedAt: ""
  };
}

export const DEFAULT_TEMPLATE_DEFINITIONS: TemplateDefinitionRecord[] = [
  buildTemplate(
    "one_site",
    "consult_sim",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}. Biopsy date: {{site1.biopsyDate}}.
The patient presents for further evaluation and management and consultation and simulation for XRT treatment.

Exam:
{{structured.focusedExam}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Pulse: {{vitals.pulse}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Impression / Plan:
{{structured.impressionPlanComments}}

The following treatment devices and target prescriptions were utilized pending radiation oncologist and medical physics review:

1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{site1.simulationComplicationsLine}}

XRT Simulation Details:
Total Fractions: {{site1.totalFractions}}
Frequency: {{site1.treatmentInterval}}
Daily dose: {{site1.dailyDose}} cGy
Total dose: {{site1.totalDose}} cGy
Energy: {{site1.energyKv}}
Tx depth: {{site1.treatmentDepthDisplay}}
Cone size: {{site1.coneSizeDisplay}}
Cutout flex shield size: {{site1.cutoutSizeDisplay}}
Additional Tx devices: {{site1.additionalDevices}}
Clinical Setup Photographs Obtained: Yes

Note: This plan will be the initial intent for treatment. The final approved plan will be determined based on what is clinically acceptable and technically feasible and reflected in the approved prescription.

Plan: Consultation for Radiotherapy.
Location: {{site1.bodyLocation}}
Lesion Size: {{site1.lesionSizeDisplay}}

Review: {{structured.consultReview}}

Treatment Options: {{structured.treatmentOptions}}

Risks and Benefits: {{structured.risksAndBenefits}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.consultFollowUp}}

Additional Information: {{visit.therapistName}} was the Radiation Therapist at time of visit.

Other Instructions: See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)

After counseling, we decided on the following plan: Schedule Radiotherapy

{{structured.ultrasoundPerformed}}

{{structured.mipsSection}}

Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date
    `
  ),
  buildTemplate(
    "one_site",
    "first_fraction",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
Last seen on {{structured.lastTreatmentDate}} for Simulation and Consultation for XRT Treatment.
The patient presents for XRT treatment.

Exam:
{{structured.focusedExam}}

{{structured.finalTreatmentSection}}

Impression / Plan Comments:
{{structured.impressionPlanComments}}

Final Approved Prescription:
Treatment Site: {{site1.txSiteName}}
Fractions: {{course.prescribedFractions}}
Frequency: {{site1.treatmentInterval}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Daily Dose: {{site1.dailyDose}} cGy
Total Dose: {{site1.totalDose}} cGy
Energy: {{site1.energyKv}}
Applicator Size: {{site1.coneSizeDisplay}}
Flex Shield Cutout: {{site1.cutoutSizeDisplay}}
Treatment Devices: {{site1.additionalDevices}}

The treatment plan developed by the physicist has been reviewed. There is excellent coverage of the skin lesion, and the plan has been approved. Dosimetry calculation has been performed and verified.

Comments: See document named "Radiation Therapy Dose Calcs" attached to patient chart

1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{course.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  ),
  buildTemplate(
    "one_site",
    "standard_treatment",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Exam:
{{structured.focusedExam}}

{{structured.finalTreatmentSection}}

Impression / Plan:
1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{course.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  ),
  buildTemplate(
    "one_site",
    "otv",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Exam:
{{structured.focusedExam}}

Exam Comment:
{{structured.examComment}}

{{structured.finalTreatmentSection}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Pulse: {{vitals.pulse}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Impression / Plan:
1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{course.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

Plan: Radiation Physics Consultation.
Location: {{site1.bodyLocation}}
Physics Consultation: Fraction Number: {{visit.treatmentNumber}} of {{course.prescribedFractions}}
{{structured.physicsComment}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  ),
  buildTemplate(
    "two_site",
    "consult_sim",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}. Biopsy date: {{site1.biopsyDate}}.
2. is following up for {{site2.diagnosisText}} on the {{site2.bodyLocation}}. Biopsy date: {{site2.biopsyDate}}.
The patient presents for further evaluation and management and consultation and simulation for XRT treatment.

Focused Exam:
{{structured.focusedExam}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Pulse: {{vitals.pulse}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Impression / Plan:
{{structured.impressionPlanComments}}

The following treatment devices and target prescriptions were utilized pending radiation oncologist and medical physics review:

1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{site1.simulationComplicationsLine}}

XRT Simulation Details Site 1:
Total Fractions: {{site1.totalFractions}}
Frequency: {{site1.treatmentInterval}}
Daily dose: {{site1.dailyDose}} cGy
Total dose: {{site1.totalDose}} cGy
Energy: {{site1.energyKv}}
Tx depth: {{site1.treatmentDepthDisplay}}
Cone size: {{site1.coneSizeDisplay}}
Cutout flex shield size: {{site1.cutoutSizeDisplay}}
Additional Tx devices: {{site1.additionalDevices}}
Clinical Setup Photographs Obtained: Yes

Note: This plan will be the initial intent for treatment. The final approved plan will be determined based on what is clinically acceptable and technically feasible and reflected in the approved prescription.

Plan: Consultation for Radiotherapy.
Location: {{site1.bodyLocation}}
Lesion Size: {{site1.lesionSizeDisplay}}

Review: {{structured.consultReview}}

Treatment Options: {{structured.treatmentOptions}}

Risks and Benefits: {{structured.risksAndBenefits}}

Follow Up: {{structured.consultFollowUp}}

Additional Information: {{visit.therapistName}} was the Radiation Therapist at time of visit.

Other Instructions: See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)

After counseling, we decided on the following plan: Schedule Radiotherapy

2. {{site2.diagnosisText}} ({{site2.icd10}})
Appropriately healing biopsy site distributed on the {{site2.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{site2.simulationComplicationsLine}}

XRT Simulation Details Site 2:
Total Fractions: {{site2.totalFractions}}
Frequency: {{site2.treatmentInterval}}
Daily dose: {{site2.dailyDose}} cGy
Total dose: {{site2.totalDose}} cGy
Energy: {{site2.energyKv}}
Tx depth: {{site2.treatmentDepthDisplay}}
Cone size: {{site2.coneSizeDisplay}}
Cutout flex shield size: {{site2.cutoutSizeDisplay}}
Additional Tx devices: {{site2.additionalDevices}}
Clinical Setup Photographs Obtained: Yes

Note: This plan will be the initial intent for treatment. The final approved plan will be determined based on what is clinically acceptable and technically feasible and reflected in the approved prescription.

Plan: Consultation for Radiotherapy.
Location: {{site2.bodyLocation}}
Lesion Size: {{site2.lesionSizeDisplay}}

Review: {{structured.consultReview}}

Treatment Options: {{structured.treatmentOptions}}

Risks and Benefits: {{structured.risksAndBenefits}}

Follow Up: {{structured.consultFollowUp}}

Additional Information: {{visit.therapistName}} was the Radiation Therapist at time of visit.

Other Instructions: See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)

After counseling, we decided on the following plan: Schedule Radiotherapy

{{structured.additionalNotesSection}}

{{structured.ultrasoundPerformed}}

{{structured.mipsSection}}

Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date
    `
  ),
  buildTemplate(
    "two_site",
    "first_fraction",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
2. is following up for {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Last seen on {{structured.lastTreatmentDate}} for Simulation and Consultation for XRT Treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}

{{structured.finalTreatmentSection}}

Impression / Plan Comments:
{{structured.impressionPlanComments}}

Final Approved Prescription Site 1:
Treatment Site: {{site1.txSiteName}}
Fractions: {{site1.prescribedFractions}}
Frequency: {{site1.treatmentInterval}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Daily Dose: {{site1.dailyDose}} cGy
Total Dose: {{site1.totalDose}} cGy
Energy: {{site1.energyKv}}
Applicator Size: {{site1.coneSizeDisplay}}
Flex Shield Cutout: {{site1.cutoutSizeDisplay}}
Treatment Devices: {{site1.additionalDevices}}

Final Approved Prescription Site 2:
Treatment Site: {{site2.txSiteName}}
Fractions: {{site2.prescribedFractions}}
Frequency: {{site2.treatmentInterval}}
Treatment Depth: {{site2.treatmentDepthDisplay}}
Daily Dose: {{site2.dailyDose}} cGy
Total Dose: {{site2.totalDose}} cGy
Energy: {{site2.energyKv}}
Applicator Size: {{site2.coneSizeDisplay}}
Flex Shield Cutout: {{site2.cutoutSizeDisplay}}
Treatment Devices: {{site2.additionalDevices}}

The treatment plan developed by the physicist has been reviewed. There is excellent coverage of the skin lesions, and the plan has been approved. Dosimetry calculation has been performed and verified.

Comments: See document named "Radiation Therapy Dose Calcs" attached to patient chart

1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site1.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

2. {{site2.diagnosisText}} ({{site2.icd10}})
Appropriately healing biopsy site distributed on the {{site2.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site2.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site2.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site2.prescribedFractions}}
Treatment Interval: {{site2.treatmentInterval}}
Current Cumulative Dose to Date: {{site2.cumulativeDose}} cGy
Total Target Dose: {{site2.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site2.additionalDevices}}
Flex Shield (Cutout Used): {{site2.cutoutSizeDisplay}}
Dose: {{site2.dailyDose}} cGy
Cone Size: {{site2.coneSizeDisplay}}
Treatment Depth: {{site2.treatmentDepthDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment sites were clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  ),
  buildTemplate(
    "two_site",
    "standard_treatment",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
2. is following up for {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}

{{structured.finalTreatmentSection}}

1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site1.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

2. {{site2.diagnosisText}} ({{site2.icd10}})
Appropriately healing biopsy site distributed on the {{site2.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site2.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site2.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site2.prescribedFractions}}
Treatment Interval: {{site2.treatmentInterval}}
Current Cumulative Dose to Date: {{site2.cumulativeDose}} cGy
Total Target Dose: {{site2.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site2.additionalDevices}}
Flex Shield (Cutout Used): {{site2.cutoutSizeDisplay}}
Dose: {{site2.dailyDose}} cGy
Cone Size: {{site2.coneSizeDisplay}}
Treatment Depth: {{site2.treatmentDepthDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment sites were clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  ),
  buildTemplate(
    "two_site",
    "otv",
    `
Name: {{patient.fullName}}
Sex: {{patient.sex}}    DOB: {{patient.dob}}    MRN: {{patient.mrn}}    Today's Date: {{visit.date}}

HPI:
This is a {{patient.age}} year old {{patient.sexLower}} who:
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}.
2. is following up for {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}

Exam Comment:
{{structured.examComment}}

{{structured.finalTreatmentSection}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Pulse: {{vitals.pulse}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

1. {{site1.diagnosisText}} ({{site1.icd10}})
Appropriately healing biopsy site distributed on the {{site1.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site1.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site1.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site1.prescribedFractions}}
Treatment Interval: {{site1.treatmentInterval}}
Current Cumulative Dose to Date: {{site1.cumulativeDose}} cGy
Total Target Dose: {{site1.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site1.additionalDevices}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}
Treatment Depth: {{site1.treatmentDepthDisplay}}

Plan: Radiation Physics Consultation.
Location: {{site1.bodyLocation}}
Physics Consultation: Fraction Number: {{visit.treatmentNumber}} of {{site1.prescribedFractions}}
{{structured.physicsComment}}

2. {{site2.diagnosisText}} ({{site2.icd10}})
Appropriately healing biopsy site distributed on the {{site2.bodyLocation}}.

Plan: Therapeutic Radiation Simulation.
{{structured.treatmentComment}}
{{site2.simulationComplicationsLine}}

Plan: Radiation Treatment.
Location: {{site2.bodyLocation}}
Name of Supervising Technician: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments: {{site2.prescribedFractions}}
Treatment Interval: {{site2.treatmentInterval}}
Current Cumulative Dose to Date: {{site2.cumulativeDose}} cGy
Total Target Dose: {{site2.totalDose}} cGy
Treatment Parameters:
Additional Treatment Devices: {{site2.additionalDevices}}
Flex Shield (Cutout Used): {{site2.cutoutSizeDisplay}}
Dose: {{site2.dailyDose}} cGy
Cone Size: {{site2.coneSizeDisplay}}
Treatment Depth: {{site2.treatmentDepthDisplay}}

Plan: Radiation Physics Consultation.
Location: {{site2.bodyLocation}}
Physics Consultation: Fraction Number: {{visit.treatmentNumber}} of {{site2.prescribedFractions}}
{{structured.physicsComment}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment sites were clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care: {{structured.postCare}}

{{structured.treatmentDeliveryStatement}}

{{structured.additionalNotesSection}}

Follow Up: {{structured.followUp}}

{{structured.mipsSection}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

    `
  )
];
