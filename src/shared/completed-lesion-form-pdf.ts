import { PDFDocument, PDFImage, StandardFonts, rgb } from "pdf-lib";

import { formatDisplayDate } from "./note-rules";
import type { PatientRecord, TreatmentCourseRecord, TreatmentSiteRecord } from "./types";

export interface CompletedLesionPhotoInput {
  image: {
    bytes: Uint8Array;
    fileName?: string;
    mimeType?: string;
  };
}

export interface CompletedLesionFormBuildInput {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  idPhotoInput?: CompletedLesionPhotoInput | null;
  photoInputs?: CompletedLesionPhotoInput[];
}

type PdfPage = ReturnType<PDFDocument["addPage"]>;
type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;

const PAGE_SIZE: [number, number] = [612, 792];
const TEXT = rgb(0.04, 0.04, 0.04);
const ACCENT = rgb(0.22, 0.32, 0.42);
const LINE = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const PHOTO_LABELS = ["Day of SIM/Consult", "Mid XRT Treatment", "6-8 Week Follow-up"];

function sanitizePdfName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim();
}

function patientFullName(patient: PatientRecord) {
  return `${patient.firstName} ${patient.lastName}`.trim() || "Patient";
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function siteFractions(course: TreatmentCourseRecord, site: TreatmentSiteRecord) {
  return site.prescribedFractions && site.prescribedFractions > 0
    ? site.prescribedFractions
    : course.prescribedFractions && course.prescribedFractions > 0
      ? course.prescribedFractions
      : null;
}

function wrapText(text: string, font: PdfFont, size: number, maxWidth: number) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function drawText(page: PdfPage, font: PdfFont, value: string, x: number, y: number, size = 11) {
  if (!value) return;
  page.drawText(value, { x, y, size, font, color: TEXT });
}

function drawLabel(page: PdfPage, font: PdfFont, value: string, x: number, y: number, size = 14) {
  page.drawText(value, { x, y, size, font, color: TEXT });
}

function drawBox(page: PdfPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({ x, y, width, height, borderColor: LINE, borderWidth: 0.6, color: WHITE });
}

function drawField(page: PdfPage, labelFont: PdfFont, valueFont: PdfFont, label: string, value: string, x: number, y: number, width: number) {
  drawLabel(page, labelFont, label, x, y + 7, 14);
  const labelWidth = labelFont.widthOfTextAtSize(label, 14) + 4;
  drawBox(page, x + labelWidth, y, width - labelWidth, 22);
  drawText(page, valueFont, value, x + labelWidth + 6, y + 6, 11);
}

function detectRasterImageType(input: CompletedLesionPhotoInput["image"]) {
  const bytes = input.bytes;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  const mimeType = input.mimeType?.toLowerCase() ?? "";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpg") || mimeType.includes("jpeg")) return "jpg";
  const fileName = input.fileName?.toLowerCase() ?? "";
  if (fileName.endsWith(".png")) return "png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "jpg";
  return null;
}

async function embedRasterImage(pdfDoc: PDFDocument, photoInput?: CompletedLesionPhotoInput) {
  if (!photoInput?.image.bytes.length) return null;
  const type = detectRasterImageType(photoInput.image);
  if (!type) return null;
  try {
    return type === "png" ? await pdfDoc.embedPng(photoInput.image.bytes) : await pdfDoc.embedJpg(photoInput.image.bytes);
  } catch {
    return null;
  }
}

function scaleToCover(image: PDFImage, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
  return {
    width: image.width * ratio,
    height: image.height * ratio
  };
}

function drawWrappedBoxText(page: PdfPage, font: PdfFont, text: string, x: number, y: number, width: number, height: number) {
  const lines = wrapText(text, font, 10, width - 14).slice(0, Math.floor((height - 12) / 12));
  let cursorY = y + height - 18;
  for (const line of lines) {
    drawText(page, font, line, x + 7, cursorY, 10);
    cursorY -= 12;
  }
}

async function drawPhotoSlots(
  pdfDoc: PDFDocument,
  page: PdfPage,
  labelFont: PdfFont,
  photoInputs: CompletedLesionPhotoInput[]
) {
  const slots = [
    { x: 50, y: 68, width: 170, height: 110 },
    { x: 220, y: 68, width: 170, height: 110 },
    { x: 390, y: 68, width: 170, height: 110 }
  ];

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    drawBox(page, slot.x, slot.y, slot.width, slot.height);
    const image = await embedRasterImage(pdfDoc, photoInputs[index]);
    if (image) {
      const fitted = scaleToCover(image, slot.width - 8, slot.height - 8);
      page.drawImage(image, {
        x: slot.x + (slot.width - fitted.width) / 2,
        y: slot.y + (slot.height - fitted.height) / 2,
        width: fitted.width,
        height: fitted.height
      });
    }
    const label = PHOTO_LABELS[index];
    const labelWidth = labelFont.widthOfTextAtSize(label, 12);
    drawLabel(page, labelFont, label, slot.x + (slot.width - labelWidth) / 2, slot.y - 28, 12);
  }
}

async function drawOptionalIdPhoto(
  pdfDoc: PDFDocument,
  page: PdfPage,
  labelFont: PdfFont,
  idPhotoInput?: CompletedLesionPhotoInput | null
) {
  const image = await embedRasterImage(pdfDoc, idPhotoInput ?? undefined);
  if (!image) {
    return;
  }

  const slot = { x: 448, y: 611, width: 96, height: 88 };
  drawBox(page, slot.x, slot.y, slot.width, slot.height);
  const fitted = scaleToCover(image, slot.width - 8, slot.height - 8);
  page.drawImage(image, {
    x: slot.x + (slot.width - fitted.width) / 2,
    y: slot.y + (slot.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height
  });
  const label = "Patient Picture";
  const labelWidth = labelFont.widthOfTextAtSize(label, 12);
  drawLabel(page, labelFont, label, slot.x + (slot.width - labelWidth) / 2, slot.y - 16, 12);
}

async function drawLesionPage(
  pdfDoc: PDFDocument,
  fonts: { title: PdfFont; label: PdfFont; value: PdfFont },
  input: CompletedLesionFormBuildInput,
  site: TreatmentSiteRecord,
  photoInputs: CompletedLesionPhotoInput[]
) {
  const page = pdfDoc.addPage(PAGE_SIZE);
  page.drawText("XRT (XOFT) Completed Lesion Form", { x: 60, y: 715, size: 16, font: fonts.title, color: ACCENT });
  await drawOptionalIdPhoto(pdfDoc, page, fonts.label, input.idPhotoInput);

  drawField(page, fonts.label, fonts.value, "Patient Name:", patientFullName(input.patient), 55, 670, 380);
  drawField(page, fonts.label, fonts.value, "Patient DOB:", formatDisplayDate(input.patient.dob), 55, 642, 380);
  drawField(page, fonts.label, fonts.value, "Lesion Site (location):", site.treatmentLocationText || site.bodyLocation, 55, 614, 380);

  drawField(page, fonts.label, fonts.value, "Diagnosis:", site.diagnosisText, 55, 574, 275);
  const fractions = siteFractions(input.course, site);
  drawField(page, fonts.label, fonts.value, "Prescribed Fractions:", fractions ? `${fractions} Fractions` : "", 335, 574, 220);
  drawLabel(page, fonts.label, "Date of SIM/Consult:", 55, 545, 13);
  drawBox(page, 222, 538, 95, 22);
  drawText(page, fonts.value, formatDisplayDate(input.course.simConsultDate || input.course.startDate), 228, 544, 11);
  drawLabel(page, fonts.label, "Date of Final Treatment:", 335, 545, 13);
  drawBox(page, 510, 538, 55, 22);
  drawText(page, fonts.value, formatDisplayDate(input.course.endDate || ""), 516, 544, 9);

  drawField(page, fonts.label, fonts.value, "Was Patient Compliant with plan of care?", "YES", 55, 500, 350);
  drawText(page, fonts.label, "If \"NO\" briefly explain below.", 405, 510, 12);
  drawBox(page, 55, 442, 500, 50);

  drawLabel(page, fonts.label, "Treatment Summary:", 55, 426, 14);
  drawBox(page, 55, 365, 500, 58);
  const summaryParts = [
    site.diagnosisText ? `Completed XRT for ${site.diagnosisText}` : "Completed XRT",
    site.treatmentLocationText || site.bodyLocation ? `at ${site.treatmentLocationText || site.bodyLocation}` : "",
    fractions ? `Prescribed course: ${fractions} fractions.` : ""
  ].filter(Boolean);
  drawWrappedBoxText(page, fonts.value, summaryParts.join(" "), 55, 365, 500, 58);

  drawLabel(page, fonts.label, "On a scale of 0-5 (0=Would not recommend 5=highly recommend)", 55, 342, 12);
  drawLabel(page, fonts.label, "would the patient recommend this XRT as a treatment option to others?", 55, 318, 13);
  drawBox(page, 490, 309, 55, 24);
  drawText(page, fonts.value, "5", 497, 316, 11);

  drawLabel(page, fonts.label, "On a scale of 0-5 (0=Would not choose XRT again, 5= Yes would definitely choose XRT again)", 55, 292, 11);
  drawLabel(page, fonts.label, "Would this patient choose XRT again if treatment of a new lesion would be", 55, 269, 12);
  drawLabel(page, fonts.label, "necessary?", 55, 251, 12);
  drawBox(page, 125, 241, 55, 24);
  drawText(page, fonts.value, "5", 132, 248, 11);

  await drawPhotoSlots(pdfDoc, page, fonts.label, photoInputs);
}

export async function buildCompletedLesionFormPdf(input: CompletedLesionFormBuildInput) {
  const pdfDoc = await PDFDocument.create();
  const title = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const label = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const value = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const sites = input.sites.slice().sort((left, right) => left.siteNumber - right.siteNumber);
  const targetSites = sites.length ? sites : [null];
  const photoInputs = input.photoInputs ?? [];

  for (const site of targetSites) {
    const normalizedSite = site ?? ({
        siteNumber: 1,
        bodyLocation: "",
        treatmentLocationText: "",
        diagnosisText: "",
        prescribedFractions: input.course.prescribedFractions
      } as TreatmentSiteRecord);
    await drawLesionPage(
      pdfDoc,
      { title, label, value },
      input,
      normalizedSite,
      photoInputs
    );
  }

  const bytes = await pdfDoc.save();
  const patientName = patientFullName(input.patient);
  const baseName = sanitizePdfName(`${patientName} - Completed Lesion Form`) || "Completed Lesion Form";
  return {
    bytes,
    fileName: `${baseName}.pdf`,
    caption: baseName
  };
}
