import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type {
  ConsultQuestionnaireInput,
  ConsultQuestionnaireItemInput,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord
} from "./types";

export interface ConsultQuestionnaireBuildInput {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  questionnaire: ConsultQuestionnaireInput;
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

function drawPatientInfo(page: PdfPage, labelFont: PdfFont, valueFont: PdfFont, patient: PatientRecord) {
  page.drawRectangle({ x: 108, y: 75, width: 260, height: 15, color: WHITE });
  page.drawRectangle({ x: 102, y: 55, width: 266, height: 15, color: WHITE });
  page.drawRectangle({ x: 34, y: 31, width: 150, height: 22, color: WHITE });
  page.drawRectangle({ x: 119, y: 35, width: 249, height: 15, color: WHITE });
  drawFormLine(page, 108, 76, 368);
  drawFormLine(page, 102, 56, 368);
  drawFormLine(page, 154, 36, 368);
  drawStaticLabel(page, labelFont, "Patient MRN/ID:", 36, 39);
  drawText(page, valueFont, patientFullName(patient), 116, 79, 36, 11);
  drawText(page, valueFont, formatDate(patient.dob), 110, 59, 20, 11);
  drawText(page, valueFont, patient.mrn, 160, 39, 24, 11);
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
  drawAnswerBox(page, font, questionnaire.medicalDevices.answer, 44, 490);
  drawCenteredOnLine(page, font, answerText(questionnaire.medicalDevices.answer), 200, 310, 479, 3);
  if (questionnaire.medicalDevices.answer === "yes") {
    drawOnLine(page, font, questionnaire.medicalDevices.details, 132, 467, 30);
  }

  drawAnswerBox(page, font, questionnaire.delayedWoundHealing.answer, 333, 490);
  drawCenteredOnLine(page, font, answerText(questionnaire.delayedWoundHealing.answer), 459, 573, 479, 3);
  if (questionnaire.delayedWoundHealing.answer === "yes") {
    drawOnLine(page, font, questionnaire.delayedWoundHealing.details, 350, 467, 38);
  }

  drawAnswerBox(page, font, questionnaire.pastRadiation.answer, 44, 414.5);
  drawCenteredOnLine(page, font, answerText(questionnaire.pastRadiation.answer), 254, 310, 414, 3);
  if (questionnaire.pastRadiation.answer === "yes") {
    drawOnLine(page, font, questionnaire.pastRadiation.details, 132, 402, 34);
  }

  drawAnswerBox(page, font, questionnaire.alcoholUse.answer, 333, 414.5);
  drawCenteredOnLine(page, font, answerText(questionnaire.alcoholUse.answer), 456, 572, 414, 3);
  if (questionnaire.alcoholUse.answer === "yes") {
    drawOnLine(page, font, questionnaire.alcoholUse.drinksPerWeek || questionnaire.alcoholUse.details, 474, 402, 18);
  }

  drawAnswerBox(page, font, questionnaire.diabetes.answer, 44, 359);
  drawCenteredOnLine(page, font, answerText(questionnaire.diabetes.answer), 167, 308, 359, 3);
  if (questionnaire.diabetes.answer === "yes") {
    drawOnLine(page, font, questionnaire.diabetes.controlled, 129, 348, 8);
    drawOnLine(page, font, questionnaire.diabetes.diabetesType || questionnaire.diabetes.details, 256, 348, 12);
  }

  drawAnswerBox(page, font, questionnaire.smoking.answer, 333, 359);
  drawFormLine(page, 440, 358, 576);
  drawCenteredOnLine(page, font, answerText(questionnaire.smoking.answer), 440, 576, 359, 3);
  if (questionnaire.smoking.answer === "yes") {
    drawOnLine(page, font, questionnaire.smoking.details, 505, 348, 16);
  }

  drawAnswerBox(page, font, skinSectionAnswer(questionnaire), 44, 306);
  drawCenteredOnLine(page, font, answerText(questionnaire.lupus.answer), 220, 303, 305, 3);
  drawCenteredOnLine(page, font, answerText(questionnaire.scleroderma.answer), 220, 303, 294, 3);
  drawCenteredOnLine(page, font, answerText(questionnaire.keloids.answer), 220, 303, 283, 3);
  if (questionnaire.otherSkinIllnesses.answer === "yes") {
    drawOnLine(page, font, questionnaire.otherSkinIllnesses.details || "Yes", 220, 272, 16);
  } else {
    drawCenteredOnLine(page, font, answerText(questionnaire.otherSkinIllnesses.answer), 220, 303, 272, 3);
  }

  drawAnswerBox(page, font, questionnaire.transplantHistory.answer, 333, 306);
  drawFormLine(page, 410, 293, 576);
  if (questionnaire.transplantHistory.answer === "yes") {
    drawOnLine(page, font, questionnaire.transplantHistory.details || "Yes", 410, 294, 26);
  } else {
    drawCenteredOnLine(page, font, answerText(questionnaire.transplantHistory.answer), 410, 576, 294, 3);
  }

  drawAnswerBox(page, font, questionnaire.bloodThinners.answer, 44, 229);
  drawFormLine(page, 296, 228, 330);
  drawCenteredOnLine(page, font, answerText(questionnaire.bloodThinners.answer), 296, 330, 229, 3);
  if (questionnaire.bloodThinners.answer === "yes") {
    drawOnLine(page, font, questionnaire.bloodThinners.details, 145, 217, 28);
  }

  drawAnswerBox(page, font, questionnaire.recentTreatmentAreaTreatments.answer, 333, 229);
  const recentTreatments =
    questionnaire.recentTreatmentAreaTreatments.answer === "yes"
      ? splitRecentTreatmentDetails(questionnaire.recentTreatmentAreaTreatments.details)
      : [];
  drawCenteredOnLine(page, font, answerText(questionnaire.recentTreatmentAreaTreatments.answer), 506, 576, 217, 3);
  drawCenteredOnLine(page, font, recentTreatments.length > 0 ? "Yes" : "No", 506, 576, 202, 3);
}

export async function buildConsultQuestionnairePdfFromTemplateBytes(
  templateBytes: Uint8Array,
  input: ConsultQuestionnaireBuildInput
) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const labelFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];
  drawPatientInfo(page, labelFont, font, input.patient);
  drawQuestionnaire(page, font, input.questionnaire);

  const bytes = await pdfDoc.save();
  return {
    ...documentIdentity(input.patient),
    bytes
  };
}
