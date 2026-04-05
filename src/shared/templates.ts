import type { CourseType, NoteType, TemplateDefinitionRecord, TemplatePlaceholderDefinition } from "./types";
import { getTemplateKey } from "./note-rules";

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
  { token: "site1.diagnosisText", description: "Diagnosis text for site 1." },
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
  { token: "site2.bodyLocation", description: "Body location text for site 2." },
  { token: "site2.treatmentLocationText", description: "Treatment location text for site 2." },
  { token: "site2.diagnosisText", description: "Diagnosis text for site 2." },
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
  { token: "vitals.bloodPressure", description: "Documented blood pressure." },
  { token: "vitals.heartRate", description: "Documented heart rate." },
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
  { token: "structured.followUp", description: "Follow-up wording." },
  { token: "structured.simulationComplications", description: "Simulation complications wording." },
  { token: "structured.treatmentComment", description: "Treatment comment wording." },
  { token: "structured.physicsComment", description: "Physics consultation wording." },
  { token: "structured.consultReview", description: "Consult review wording." },
  { token: "structured.treatmentOptions", description: "Treatment options wording." },
  { token: "structured.risksAndBenefits", description: "Risks and benefits wording." },
  { token: "structured.additionalInformation", description: "Additional information wording." },
  { token: "structured.otherInstructions", description: "Other instructions wording." },
  { token: "structured.supervisedBy", description: "Supervising clinician or service." },
  { token: "structured.startRadiationDate", description: "Planned treatment start date." },
  { token: "structured.ultrasoundPerformed", description: "Ultrasound wording if applicable." },
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
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}}. Biopsy date: {{structured.biopsyDate}}.
The patient presents for further evaluation and management and consultation and simulation for XRT treatment.

Exam:
{{structured.focusedExam}}
{{structured.healingDescription}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Impression / Plan:
{{structured.impressionPlanComments}}

1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

The following treatment devices and target prescriptions were utilized pending radiation oncologist and medical physics review:

Plan: Therapeutic Radiation Simulation.
Number of Treatment Areas: 1
Number of Radiation Ports: 1
Port Type: parallel opposed
Number of Blocks: {{site1.numberOfBlocks}}
Type of Blocks: Complex
{{site1.simulationComplicationsLine}}
Applicator: {{site1.coneSizeDisplay}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Lesion Size: {{site1.lesionSizeDisplay}}
Lesion / Treatment Location: {{site1.treatmentLocationText}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Additional Treatment Devices: {{site1.additionalDevices}}

Plan: Consultation for Radiotherapy.
Location: {{site1.bodyLocation}}

Review:
{{structured.consultReview}}

Treatment Options:
{{structured.treatmentOptions}}

Risks and Benefits:
{{structured.risksAndBenefits}}

{{structured.additionalNotesSection}}

Follow Up:
The patient is scheduled to start Radiation Therapy on {{structured.startRadiationDate}}

Additional Information:
{{visit.therapistName}} RT(T) was the Radiation Therapist at time of visit.

Other Instructions:
See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)

After counseling, we decided on the following plan: Schedule Radiotherapy

{{structured.ultrasoundPerformed}}

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
{{structured.healingDescription}}

Impression / Plan Comments:
{{structured.impressionPlanComments}}

Radiation Therapy Prescription:
Number of Treatments: {{course.prescribedFractions}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Daily Dose: {{site1.dailyDose}} cGy
Total Dose: {{site1.totalDose}} cGy
Flex Shield Cutout Size: {{site1.flexShieldCutoutText}}
Additional Treatment Devices: {{site1.additionalDevices}}

The treatment plan developed by the physicist has been reviewed. There is excellent coverage of the skin lesion, and the plan has been approved. Dosimetry calculation has been performed and verified.

Comments: See document named "Radiation Therapy Dose Calcs" attached to patient chart

1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

Plan:
Therapeutic Radiation Simulation.
Number of Treatment Areas: 1
Number of Radiation Ports: 1
Port Type: parallel opposed
Number of Blocks: {{site1.numberOfBlocks}}
Type of Blocks: Simple
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
Shields: {{site1.shields}}
Cutout / Shield Details: {{site1.cutoutSizeDisplay}}
kV: {{site1.energyKv}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care:
{{structured.postCare}}

Comments: Tx machine: {{site1.machine}}, Treatment Depth: {{site1.treatmentDepthDisplay}}

{{structured.treatmentComment}}

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}

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
{{structured.healingDescription}}

Impression / Plan:
1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

Plan: Therapeutic Radiation Simulation.
Number of Treatment Areas: 1
Number of Radiation Ports: 1
Port Type: parallel opposed
Number of Blocks: {{site1.numberOfBlocks}}
Type of Blocks: Simple
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
Shields: {{site1.shields}}
Cutout / Shield Details: {{site1.cutoutSizeDisplay}}
kV: {{site1.energyKv}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care:
{{structured.postCare}}

Comments: Tx machine: {{site1.machine}}, Treatment Depth: {{site1.treatmentDepthDisplay}}

{{structured.treatmentComment}}

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}

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
{{structured.healingDescription}}

Exam Comment:
Patient evaluated today during the current course of radiation therapy for {{site1.diagnosisText}} of the {{site1.bodyLocation}}. Current dose reviewed {{site1.cumulativeDose}}/{{site1.totalDose}} cGy in {{visit.treatmentNumber}} of {{course.prescribedFractions}} fractions. Patient reports good tolerance with no pain or new or worsening symptoms. Focused skin exam shows mild expected erythema without breakdown, ulceration, or infection. No changes required; reviewed ongoing skin care, anticipated acute effects, and the plan to continue radiation therapy as prescribed.

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Impression / Plan:
1. {{site1.diagnosisText}} ({{site1.icd10}})
{{structured.healingDescription}}

Plan: Therapeutic Radiation Simulation.
Number of Treatment Areas: 1
Number of Radiation Ports: 1
Port Type: parallel opposed
Number of Blocks: {{site1.numberOfBlocks}}
Type of Blocks: Simple
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
Shields: {{site1.shields}}
Cutout / Shield Details: {{site1.cutoutSizeDisplay}}
kV: {{site1.energyKv}}
Dose: {{site1.dailyDose}} cGy
Cone Size: {{site1.coneSizeDisplay}}

Written consent obtained. The risks and benefits of XRT therapy were discussed in detail. Specifically, the risks of infection, scarring, bleeding, radiation dermatitis, prolonged wound healing, incomplete removal, nerve injury, inability to clear the tumor, and recurrence were addressed. The treatment site was clearly identified and confirmed by the patient. The patient received XRT as outlined above.

Post Care:
{{structured.postCare}}

Comments: Tx machine: {{site1.machine}}, Treatment Depth: {{site1.treatmentDepthDisplay}}

{{structured.treatmentComment}}

Plan: Radiation Physics Consultation.
Physics Consultation: Fraction Number: {{visit.treatmentNumber}} of {{course.prescribedFractions}}
{{structured.physicsComment}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}
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
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}} and {{site2.diagnosisText}} on the {{site2.bodyLocation}}. Biopsy date: {{structured.biopsyDate}}.
The patient presents for further evaluation and management and consultation and simulation for XRT treatment.

Focused Exam:
{{structured.focusedExam}}
{{structured.healingDescription}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

The patient has decided to proceed with radiation treatment instead of surgery due to concerns with scarring, healing, and closure.

Time was spent by the physician and radiation therapist assessing and managing the patient on the date of encounter, including review of history, medically appropriate examination, counseling, documentation, and coordination of care.

The patient will undergo radiation therapy treatment for non-melanoma skin cancer. A simulation was medically necessary to measure the lesion and to determine the appropriate flex-shield blocking to assure adequate coverage of the target lesion while sparing normal tissue. On today's visit, following informed consent, the treatment field was demarcated, and depth measurements were performed for the radiation therapy treatment plan. Multiple clinical setup photographs were taken which will be used for the development of the prescription and treatment plan. All relevant information specifically regarding this patient's superficial skin lesion will be reviewed by a Board-Certified Radiation Oncologist, who will provide me with an advisory opinion as to treatment dose, number of fractions/treatments, and treatment depth. I will consider his recommendation, along with all other aspects of this patient's condition, including patient's treatment preference, other comorbidities, and move forward with this patient's care.

Simulation Site 1:
Treatment Site: {{site1.bodyLocation}}
Diagnosis: {{site1.diagnosisText}}
ICD10: {{site1.icd10}}
Number of Blocks: {{site1.numberOfBlocks}}
Type of Block: Complex
{{site1.simulationComplicationsLine}}
Applicator: {{site1.coneSizeDisplay}}
Flex Shield (Cutout Used): {{site1.cutoutSizeDisplay}}
Lesion Size: {{site1.lesionSizeDisplay}}
Lesion / Treatment Location: {{site1.treatmentLocationText}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Additional Treatment Devices: {{site1.additionalDevices}}

Consultation for Radiotherapy Site 1:
Treatment Site: {{site1.bodyLocation}}
Review: {{structured.consultReview}}

Treatment Options:
{{structured.treatmentOptions}}

Risks and Benefits:
{{structured.risksAndBenefits}}

After counseling, we decided on the following plan: Schedule Radiotherapy

Simulation Site 2:
Treatment Site: {{site2.bodyLocation}}
Diagnosis: {{site2.diagnosisText}}
ICD10: {{site2.icd10}}
Number of Blocks: {{site2.numberOfBlocks}}
Type of Block: Complex
{{site2.simulationComplicationsLine}}
Applicator: {{site2.coneSizeDisplay}}
Flex Shield (Cutout Used): {{site2.cutoutSizeDisplay}}
Lesion Size: {{site2.lesionSizeDisplay}}
Lesion / Treatment Location: {{site2.treatmentLocationText}}
Treatment Depth: {{site2.treatmentDepthDisplay}}
Additional Treatment Devices: {{site2.additionalDevices}}

Consultation for Radiotherapy Site 2:
Treatment Site: {{site2.bodyLocation}}
Review: {{structured.consultReview}}

Treatment Options:
{{structured.treatmentOptions}}

Risks and Benefits:
{{structured.risksAndBenefits}}

After counseling, we decided on the following plan: Schedule Radiotherapy

{{structured.additionalNotesSection}}

Follow Up:
The patient is scheduled to start radiation therapy on {{structured.startRadiationDate}}.

Additional Information:
{{visit.therapistName}} RT(T) was the Radiation Therapist at time of visit.

Other Instructions:
See attachments within chart for further information. (Radiation Therapy Simulation Document & Radiation Therapy Consent Form)

{{structured.ultrasoundPerformed}}

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
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}} and {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Last seen on {{structured.lastTreatmentDate}} for Simulation and Consultation for XRT Treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}
{{structured.healingDescription}}

Treatment Site 1 Prescription:
{{structured.impressionPlanComments}}
Number of Treatments: {{site1.prescribedFractions}}
Treatment Depth: {{site1.treatmentDepthDisplay}}
Daily Dose: {{site1.dailyDose}} cGy
Total Dose: {{site1.totalDose}} cGy
Flex Shield Cutout Size: {{site1.flexShieldCutoutText}}
Cone / Applicator: {{site1.coneSizeDisplay}} cone
Additional Treatment Devices: {{site1.additionalDevices}}

Treatment Site 2 Prescription:
{{structured.impressionPlanComments}}
Number of Treatments: {{site2.prescribedFractions}}
Treatment Depth: {{site2.treatmentDepthDisplay}}
Daily Dose: {{site2.dailyDose}} cGy
Total Dose: {{site2.totalDose}} cGy
Flex Shield Cutout Size: {{site2.flexShieldCutoutText}}
Cone / Applicator: {{site2.coneSizeDisplay}} cone
Additional Treatment Devices: {{site2.additionalDevices}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 1
Body Location 1: {{site1.bodyLocation}}
{{site1.simulationComplicationsLine}}
Therapist Site 1: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 1: {{site1.prescribedFractions}}
Treatment Interval Site 1: {{site1.treatmentInterval}}
Cumulative Dose Site 1: {{site1.cumulativeDose}} cGy
Target Dose Site 1: {{site1.totalDose}} cGy
Shields Site 1: {{site1.shields}}
Machine Site 1: {{site1.machine}}
Energy Site 1: {{site1.energyKv}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 2
Body Location 2: {{site2.bodyLocation}}
{{site2.simulationComplicationsLine}}
Therapist Site 2: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 2: {{site2.prescribedFractions}}
Treatment Interval Site 2: {{site2.treatmentInterval}}
Cumulative Dose Site 2: {{site2.cumulativeDose}} cGy
Target Dose Site 2: {{site2.totalDose}} cGy
Shields Site 2: {{site2.shields}}
Machine Site 2: {{site2.machine}}
Energy Site 2: {{site2.energyKv}}

Therapeutic Radiation Simulation & Radiation Treatment Comment Sites 1 & 2:
{{structured.treatmentComment}}

Post Care:
{{structured.postCare}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}
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
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}} and {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}
{{structured.healingDescription}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 1
Body Location 1: {{site1.bodyLocation}}
{{site1.simulationComplicationsLine}}
Therapist Site 1: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 1: {{site1.prescribedFractions}}
Treatment Interval Site 1: {{site1.treatmentInterval}}
Cumulative Dose Site 1: {{site1.cumulativeDose}} cGy
Target Dose Site 1: {{site1.totalDose}} cGy
Shields Site 1: {{site1.shields}}
Machine Site 1: {{site1.machine}}
Energy Site 1: {{site1.energyKv}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 2
Body Location 2: {{site2.bodyLocation}}
{{site2.simulationComplicationsLine}}
Therapist Site 2: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 2: {{site2.prescribedFractions}}
Treatment Interval Site 2: {{site2.treatmentInterval}}
Cumulative Dose Site 2: {{site2.cumulativeDose}} cGy
Target Dose Site 2: {{site2.totalDose}} cGy
Shields Site 2: {{site2.shields}}
Machine Site 2: {{site2.machine}}
Energy Site 2: {{site2.energyKv}}

Therapeutic Radiation Simulation & Radiation Treatment Comment Sites 1 & 2:
{{structured.treatmentComment}}

Post Care:
{{structured.postCare}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}
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
1. is following up for {{site1.diagnosisText}} on the {{site1.bodyLocation}} and {{site2.diagnosisText}} on the {{site2.bodyLocation}}.
Patient was last seen on {{structured.lastTreatmentDate}} for XRT treatment.
The patient presents for XRT treatment.

Focused Exam Sites 1 & 2:
{{structured.focusedExam}}
{{structured.healingDescription}}

Exam Comment:
{{structured.examComment}}

Exam Vitals:
Blood Pressure: {{vitals.bloodPressure}}
Heart Rate: {{vitals.heartRate}}
Oxygen Saturation: {{vitals.oxygenSaturation}}
Weight: {{vitals.weight}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 1
Body Location 1: {{site1.bodyLocation}}
{{site1.simulationComplicationsLine}}
Therapist Site 1: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 1: {{site1.prescribedFractions}}
Treatment Interval Site 1: {{site1.treatmentInterval}}
Cumulative Dose Site 1: {{site1.cumulativeDose}} cGy
Target Dose Site 1: {{site1.totalDose}} cGy
Shields Site 1: {{site1.shields}}
Machine Site 1: {{site1.machine}}
Energy Site 1: {{site1.energyKv}}

Plan: Therapeutic Radiation Simulation & Radiation Treatment Site 2
Body Location 2: {{site2.bodyLocation}}
{{site2.simulationComplicationsLine}}
Therapist Site 2: {{visit.therapistName}}
Current Treatment Number: {{visit.treatmentNumber}}
Total Treatments Site 2: {{site2.prescribedFractions}}
Treatment Interval Site 2: {{site2.treatmentInterval}}
Cumulative Dose Site 2: {{site2.cumulativeDose}} cGy
Target Dose Site 2: {{site2.totalDose}} cGy
Shields Site 2: {{site2.shields}}
Machine Site 2: {{site2.machine}}
Energy Site 2: {{site2.energyKv}}

Therapeutic Radiation Simulation & Radiation Treatment Comment Sites 1 & 2:
{{structured.treatmentComment}}

Post Care:
{{structured.postCare}}

Plan: Radiation Physics Consultation for Body Locations 1 & 2
Procedure Note:
Physics Consultation Fraction Number: {{visit.treatmentNumber}}
{{structured.physicsComment}}

Treatment Supervised by:




________________________________________
Physician Signature
{{structured.supervisedBy}} - {{settings.dermatologyOfficeName}}


______________________
Date

{{structured.additionalNotesSection}}

Follow Up:
{{structured.followUp}}
    `
  )
];
