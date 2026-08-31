import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type {
  ConsultQuestionnaireInput,
  ConsultQuestionnaireItemInput,
  CourseDocumentRecord,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord,
  Vitals
} from "./types";

export interface ConsultQuestionnaireBuildInput {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  questionnaire: ConsultQuestionnaireInput;
  logoInput?: { bytes: Uint8Array; fileName?: string } | null;
}

type PdfPage = ReturnType<PDFDocument["getPages"]>[number];
type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;

const TEXT_COLOR = rgb(0.03, 0.08, 0.12);
const WHITE = rgb(1, 1, 1);
const BOX_MARK_COLOR = rgb(0.02, 0.05, 0.08);
const FORM_LINE_COLOR = rgb(0.32, 0.24, 0.13);
const RECENT_TREATMENT_OPTIONS = ["Lasers", "Chemical peels", "Chemo cream"] as const;

function sanitizePdfName(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }
  const [year, month, day] = value.split("-");
  if (year && month && day) {
    return `${month}/${day}/${year}`;
  }
  return value;
}

function patientFullName(patient: PatientRecord) {
  return `${patient.firstName} ${patient.lastName}`.trim() || "Patient";
}

function documentIdentity(patient: PatientRecord) {
  const name = sanitizePdfName(patientFullName(patient)) || "Patient";
  return {
    caption: `${name} - Radiation Questionaire`,
    fileName: `${name} - Radiation Questionaire.pdf`
  };
}

function item(answer: ConsultQuestionnaireItemInput["answer"] = "no", details = ""): ConsultQuestionnaireItemInput {
  return { answer, details };
}

export function createDefaultConsultQuestionnaireInput(): ConsultQuestionnaireInput {
  return {
    vitals: {
      bloodPressure: "",
      heartRate: "",
      pulse: "",
      oxygenSaturation: "",
      weight: ""
    },
    medicalDevices: item(),
    delayedWoundHealing: item(),
    pastRadiation: item(),
    alcoholUse: { ...item(), drinksPerWeek: "" },
    diabetes: { ...item(), controlled: "", diabetesType: "" },
    smoking: item(),
    skinConditionsAnswer: "no",
    lupus: item(),
    scleroderma: item(),
    keloids: item(),
    otherSkinIllnesses: item(),
    transplantHistory: item(),
    bloodThinners: item(),
    recentTreatmentAreaTreatments: item()
  };
}

function fitText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function drawText(page: PdfPage, font: PdfFont, value: string, x: number, y: number, maxLength = 42, size = 9) {
  const text = fitText(value, maxLength);
  if (!text) {
    return;
  }
  page.drawText(text, { x, y, size, font, color: TEXT_COLOR });
}

function drawStaticLabel(page: PdfPage, font: PdfFont, value: string, x: number, y: number) {
  page.drawText(value, { x, y, size: 11, font, color: FORM_LINE_COLOR });
}

function drawFormLine(page: PdfPage, x1: number, y: number, x2: number) {
  page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness: 0.7,
    color: FORM_LINE_COLOR
  });
}

function drawAnswerBox(page: PdfPage, font: PdfFont, value: ConsultQuestionnaireItemInput["answer"], x: number, y: number, size = 14) {
  const marker = value === "yes" ? "Y" : value === "no" ? "N" : "";
  if (!marker) {
    return;
  }
  const markerSize = 9;
  page.drawText(marker, {
    x: x - 1.75,
    y: y + 8.4,
    size: markerSize,
    font,
    color: BOX_MARK_COLOR
  });
}

function answerText(answer: ConsultQuestionnaireItemInput["answer"]) {
  return answer === "yes" ? "Yes" : answer === "no" ? "No" : "";
}

function splitRecentTreatmentDetails(value: string) {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const selected = RECENT_TREATMENT_OPTIONS.filter((option) =>
    parts.some((part) => part.toLowerCase() === option.toLowerCase())
  );
  return selected;
}

function drawOnLine(page: PdfPage, font: PdfFont, value: string, x: number, lineY: number, maxLength = 38) {
  drawText(page, font, value, x, lineY + 3, maxLength);
}

function drawSmallOnLine(page: PdfPage, font: PdfFont, value: string, x: number, lineY: number, maxLength = 30) {
  drawText(page, font, value, x, lineY + 2, maxLength, 7);
}

function drawTinyOnLine(page: PdfPage, font: PdfFont, value: string, x: number, lineY: number, maxLength = 34) {
  drawText(page, font, value, x, lineY + 2, maxLength, 6);
}

function drawCenteredOnLine(page: PdfPage, font: PdfFont, value: string, x1: number, x2: number, lineY: number, maxLength = 12) {
  const text = fitText(value, maxLength);
  if (!text) {
    return;
  }
  const size = 9;
  const width = font.widthOfTextAtSize(text, size);
  const x = x1 + Math.max(0, x2 - x1 - width) / 2;
  page.drawText(text, { x, y: lineY + 3, size, font, color: TEXT_COLOR });
}

function drawPatientInfo(page: PdfPage, valueFont: PdfFont, patient: PatientRecord) {
  page.drawRectangle({ x: 102, y: 669, width: 184, height: 16, color: WHITE });
  page.drawRectangle({ x: 334, y: 669, width: 154, height: 16, color: WHITE });
  page.drawRectangle({ x: 80, y: 642, width: 204, height: 16, color: WHITE });
  drawFormLine(page, 103, 673, 284);
  drawFormLine(page, 335, 673, 485);
  drawFormLine(page, 81, 646, 281);
  drawText(page, valueFont, patientFullName(patient), 107, 676, 31, 10);
  drawText(page, valueFont, formatDate(patient.dob), 339, 676, 18, 10);
  drawText(page, valueFont, patient.mrn, 85, 649, 30, 10);
}

export function getQuestionnaireVitals(documents: CourseDocumentRecord[]) {
  return documents.find((document) => document.documentType === "consult_questionnaire")?.questionnaireVitals ?? null;
}

export function fillMissingVitals(existing: Vitals, questionnaireVitals: Vitals | null | undefined): Vitals {
  if (!questionnaireVitals) {
    return existing;
  }
  return {
    ...existing,
    bloodPressure: existing.bloodPressure.trim() || questionnaireVitals.bloodPressure.trim(),
    heartRate: existing.heartRate.trim() || questionnaireVitals.heartRate.trim(),
    oxygenSaturation: existing.oxygenSaturation.trim() || questionnaireVitals.oxygenSaturation.trim()
  };
}

function drawVitals(page: PdfPage, font: PdfFont, questionnaire: ConsultQuestionnaireInput) {
  const { bloodPressure, heartRate, oxygenSaturation } = questionnaire.vitals;
  if (![bloodPressure, heartRate, oxygenSaturation].some((value) => value.trim())) {
    page.drawRectangle({ x: 35, y: 578, width: 542, height: 57, color: WHITE });
    return;
  }

  drawCenteredOnLine(page, font, bloodPressure, 64, 157, 584, 16);
  drawCenteredOnLine(page, font, heartRate, 274, 317, 584, 8);
  drawCenteredOnLine(page, font, oxygenSaturation, 459, 502, 584, 8);
}

async function drawCustomLogo(
  pdfDoc: PDFDocument,
  page: PdfPage,
  logoInput: NonNullable<ConsultQuestionnaireBuildInput["logoInput"]>
) {
  const lowerName = (logoInput.fileName ?? "").toLowerCase();
  const isPng = lowerName.endsWith(".png") || (
    logoInput.bytes[0] === 0x89 &&
    logoInput.bytes[1] === 0x50 &&
    logoInput.bytes[2] === 0x4e &&
    logoInput.bytes[3] === 0x47
  );
  const image = isPng
    ? await pdfDoc.embedPng(logoInput.bytes)
    : await pdfDoc.embedJpg(logoInput.bytes);
  const box = { x: 458, y: 708, width: 120, height: 66 };
  page.drawRectangle({ ...box, color: WHITE });
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height
  });
}

function skinSectionAnswer(questionnaire: ConsultQuestionnaireInput): ConsultQuestionnaireItemInput["answer"] {
  const answers = [
    questionnaire.lupus.answer,
    questionnaire.scleroderma.answer,
    questionnaire.keloids.answer,
    questionnaire.otherSkinIllnesses.answer
  ];
  if (answers.some((answer) => answer === "yes")) {
    return "yes";
  }
  if (questionnaire.skinConditionsAnswer) {
    return questionnaire.skinConditionsAnswer;
  }
  return answers.every((answer) => answer === "no") ? "no" : "";
}

function drawQuestionnaire(page: PdfPage, font: PdfFont, questionnaire: ConsultQuestionnaireInput) {
  drawAnswerBox(page, font, questionnaire.medicalDevices.answer, 41, 500);
  drawCenteredOnLine(page, font, answerText(questionnaire.medicalDevices.answer), 66, 152, 483, 3);
  if (questionnaire.medicalDevices.answer === "yes") {
    drawSmallOnLine(page, font, questionnaire.medicalDevices.details, 113, 471, 28);
  }

  drawAnswerBox(page, font, questionnaire.delayedWoundHealing.answer, 311, 500);
  drawCenteredOnLine(page, font, answerText(questionnaire.delayedWoundHealing.answer), 388, 413, 483, 3);

  drawAnswerBox(page, font, questionnaire.pastRadiation.answer, 41, 443);
  drawCenteredOnLine(page, font, answerText(questionnaire.pastRadiation.answer), 185, 230, 438, 3);
  if (questionnaire.pastRadiation.answer === "yes") {
    drawOnLine(page, font, questionnaire.pastRadiation.details, 99, 426, 24);
  }

  drawAnswerBox(page, font, questionnaire.alcoholUse.answer, 311, 443);
  drawCenteredOnLine(page, font, answerText(questionnaire.alcoholUse.answer), 417, 492, 438, 3);
  if (questionnaire.alcoholUse.answer === "yes") {
    drawOnLine(page, font, questionnaire.alcoholUse.drinksPerWeek || questionnaire.alcoholUse.details, 426, 426, 12);
  }

  drawAnswerBox(page, font, questionnaire.diabetes.answer, 41, 398);
  drawCenteredOnLine(page, font, answerText(questionnaire.diabetes.answer), 137, 237, 392, 3);
  if (questionnaire.diabetes.answer === "yes") {
    drawOnLine(page, font, questionnaire.diabetes.controlled, 104, 380, 18);
    drawOnLine(page, font, questionnaire.diabetes.diabetesType || questionnaire.diabetes.details, 89, 368, 22);
  }

  drawAnswerBox(page, font, questionnaire.smoking.answer, 311, 398);
  drawCenteredOnLine(page, font, answerText(questionnaire.smoking.answer), 413, 493, 392, 3);
  if (questionnaire.smoking.answer === "yes") {
    drawTinyOnLine(page, font, questionnaire.smoking.details, 444, 380, 18);
  }

  drawAnswerBox(page, font, skinSectionAnswer(questionnaire), 41, 340);
  drawCenteredOnLine(page, font, answerText(questionnaire.lupus.answer), 126, 241, 335, 3);
  drawCenteredOnLine(page, font, answerText(questionnaire.scleroderma.answer), 152, 237, 323, 3);
  drawCenteredOnLine(page, font, answerText(questionnaire.keloids.answer), 113, 243, 311, 3);
  if (questionnaire.otherSkinIllnesses.answer === "yes") {
    drawOnLine(page, font, questionnaire.otherSkinIllnesses.details || "Yes", 173, 299, 12);
  } else {
    drawCenteredOnLine(page, font, answerText(questionnaire.otherSkinIllnesses.answer), 173, 233, 299, 3);
  }

  drawAnswerBox(page, font, questionnaire.transplantHistory.answer, 311, 340);
  if (questionnaire.transplantHistory.answer === "yes") {
    drawOnLine(page, font, questionnaire.transplantHistory.details || "Yes", 311, 323, 24);
  } else {
    drawCenteredOnLine(page, font, answerText(questionnaire.transplantHistory.answer), 311, 451, 323, 3);
  }

  drawAnswerBox(page, font, questionnaire.bloodThinners.answer, 41, 271);
  drawCenteredOnLine(page, font, answerText(questionnaire.bloodThinners.answer), 228, 278, 266, 3);
  if (questionnaire.bloodThinners.answer === "yes") {
    drawOnLine(page, font, questionnaire.bloodThinners.details, 113, 254, 22);
  }

  drawAnswerBox(page, font, questionnaire.recentTreatmentAreaTreatments.answer, 311, 271);
  const recentTreatments =
    questionnaire.recentTreatmentAreaTreatments.answer === "yes"
      ? splitRecentTreatmentDetails(questionnaire.recentTreatmentAreaTreatments.details)
      : [];
  drawOnLine(
    page,
    font,
    recentTreatments.length > 0 ? recentTreatments.join(", ") : answerText(questionnaire.recentTreatmentAreaTreatments.answer),
    311,
    230,
    27
  );
}

export async function buildConsultQuestionnairePdfFromTemplateBytes(
  templateBytes: Uint8Array,
  input: ConsultQuestionnaireBuildInput
) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];
  drawPatientInfo(page, font, input.patient);
  drawVitals(page, font, input.questionnaire);
  drawQuestionnaire(page, font, input.questionnaire);
  if (input.logoInput) {
    await drawCustomLogo(pdfDoc, page, input.logoInput);
  }

  const bytes = await pdfDoc.save();
  return {
    ...documentIdentity(input.patient),
    bytes
  };
}
