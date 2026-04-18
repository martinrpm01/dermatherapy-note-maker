import { PDFDocument, StandardFonts, type PDFCheckBox, type PDFTextField } from "pdf-lib";

import { formatDisplayDate, normalizeOptionValue } from "./note-rules";
import type {
  ConsentSigningInput,
  PatientRecord,
  StoredAssetUpload,
  TreatmentCourseRecord,
  TreatmentSiteRecord
} from "./types";

type ConsentSiteFieldMap = {
  treatmentSite: string;
  bcc: string;
  scc: string;
  sccis: string;
};

const DATE_FIELDS = ["Text Box 4", "Text Box 4_2"] as const;

const SITE_1_FIELDS: ConsentSiteFieldMap = {
  treatmentSite: "Text Box 1_3",
  bcc: "Check Box 2",
  scc: "Check Box 2_2",
  sccis: "Check Box 2_3"
};

const SITE_2_FIELDS: ConsentSiteFieldMap = {
  treatmentSite: "Text Box 1_4",
  bcc: "Check Box 2_4",
  scc: "Check Box 3",
  sccis: "Check Box 2_5"
};

const INITIALS_FIELD = "Text Box 2";
const FORMER_RADIATION_ACKNOWLEDGMENT_FIELD = "Check Box 1";
const MEDICAL_DEVICES_ACKNOWLEDGMENT_FIELD = "Check Box 1_2";
const PATIENT_SIGNATURE_FIELD = "Text Box 3";
const PATIENT_PRINTED_NAME_FIELD = "Text Box 3_2";
const WITNESS_SIGNATURE_FIELD = "Text Box 3_3";

export interface ConsentFormBuildInput {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
}

function sanitizeDocumentName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim();
}

function buildConsentDocumentIdentity(patient: PatientRecord) {
  const patientName = `${patient.firstName} ${patient.lastName}`.trim() || patient.id;
  const safeName = sanitizeDocumentName(patientName || "patient");
  return {
    patientName,
    caption: `${patientName} Radiation Consent`.trim(),
    fileName: `${safeName} Radiation Consent.pdf`
  };
}

function bytesFromBase64(base64: string) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeUploadDataUrl(upload: StoredAssetUpload) {
  const dataUrl = upload.dataUrl || "";
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) {
    throw new Error("Could not decode uploaded consent form.");
  }

  return {
    mimeType: upload.mimeType || match[1] || "application/octet-stream",
    bytes: bytesFromBase64(match[2])
  };
}

function decodeImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) {
    throw new Error("Could not decode signature image.");
  }

  return {
    mimeType: match[1] || "image/png",
    bytes: bytesFromBase64(match[2])
  };
}

function setText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  const field = form.getTextField(name) as PDFTextField;
  field.setText(value || "");
}

function setTextWithFontSize(
  form: ReturnType<PDFDocument["getForm"]>,
  name: string,
  value: string,
  fontSize: number
) {
  const field = form.getTextField(name) as PDFTextField;
  field.setFontSize(fontSize);
  field.setText(value || "");
}

function setCheckbox(form: ReturnType<PDFDocument["getForm"]>, name: string, checked: boolean) {
  const field = form.getCheckBox(name) as PDFCheckBox;
  if (checked) {
    field.check();
  } else {
    field.uncheck();
  }
}

function getFieldRect(form: ReturnType<PDFDocument["getForm"]>, name: string) {
  const field = form.getField(name);
  const widget = field.acroField.getWidgets()[0];
  return widget.getRectangle();
}

async function drawSignatureImage(
  pdfDoc: PDFDocument,
  page: ReturnType<PDFDocument["getPages"]>[number],
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  options?: {
    reservedBottom?: number;
    widthScale?: number;
    heightScale?: number;
    offsetX?: number;
    offsetY?: number;
  }
) {
  const reservedBottom = options?.reservedBottom ?? 0;
  const { mimeType, bytes } = decodeImageDataUrl(dataUrl);
  const image = mimeType === "image/png"
    ? await pdfDoc.embedPng(bytes)
    : await pdfDoc.embedJpg(bytes);

  const usableHeight = Math.max(1, rect.height - reservedBottom);
  const targetWidth = rect.width * (options?.widthScale ?? 1.12);
  const targetHeight = usableHeight * (options?.heightScale ?? 1.35);
  const scale = Math.min(targetWidth / image.width, targetHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const x = rect.x + (rect.width - width) / 2 + (options?.offsetX ?? 0);
  const y = rect.y + reservedBottom + (usableHeight - height) / 2 + (options?.offsetY ?? 0);
  page.drawImage(image, { x, y, width, height });
}

function fitTextSize(
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  text: string,
  width: number,
  maxSize: number,
  minSize: number
) {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > width) {
    size -= 0.5;
  }
  return Math.max(minSize, size);
}

function ensureTherapistCredentials(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return /RT\(T\)\s*$/i.test(normalized) ? normalized : `${normalized} RT(T)`;
}

function drawFittedText(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  text: string,
  rect: { x: number; y: number; width: number; height: number },
  options?: {
    paddingX?: number;
    maxSize?: number;
    minSize?: number;
    offsetY?: number;
    align?: "left" | "center";
  }
) {
  if (!text.trim()) {
    return;
  }

  const paddingX = options?.paddingX ?? 4;
  const maxSize = options?.maxSize ?? 15;
  const minSize = options?.minSize ?? 9;
  const size = fitTextSize(font, text, Math.max(1, rect.width - paddingX * 2), maxSize, minSize);
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = options?.align === "center"
    ? rect.x + Math.max(paddingX, (rect.width - textWidth) / 2)
    : rect.x + paddingX;
  page.drawText(text, {
    x,
    y: rect.y + (rect.height - size) / 2 + (options?.offsetY ?? 0),
    size,
    font
  });
}

function toPathologyFlags(diagnosisText: string) {
  const normalized = normalizeOptionValue(diagnosisText);
  return {
    bcc: normalized.includes("basal"),
    sccis: normalized.includes("in-situ") || normalized.includes("in situ"),
    scc: normalized.includes("squamous") && !(normalized.includes("in-situ") || normalized.includes("in situ"))
  };
}

function fillConsentSite(
  form: ReturnType<PDFDocument["getForm"]>,
  fields: ConsentSiteFieldMap,
  site: TreatmentSiteRecord | null
) {
  if (!site) {
    setText(form, fields.treatmentSite, "");
    setCheckbox(form, fields.bcc, false);
    setCheckbox(form, fields.scc, false);
    setCheckbox(form, fields.sccis, false);
    return;
  }

  const pathology = toPathologyFlags(site.diagnosisText);
  setText(form, fields.treatmentSite, site.treatmentLocationText || site.bodyLocation);
  setCheckbox(form, fields.bcc, pathology.bcc);
  setCheckbox(form, fields.scc, pathology.scc);
  setCheckbox(form, fields.sccis, pathology.sccis);
}

function shouldIncludePregnancyInitials(patient: PatientRecord) {
  return patient.sex.trim().toLowerCase() === "female";
}

export async function buildConsentFormPdfFromTemplateBytes(
  templateBytes: Uint8Array,
  input: ConsentFormBuildInput
) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  setText(form, "Text Box 1", `${input.patient.firstName} ${input.patient.lastName}`.trim());
  setText(form, "Text Box 1_2", formatDisplayDate(input.patient.dob));
  setText(form, "Text Box 1_5", input.patient.mrn);
  const consultDate = formatDisplayDate(input.course.simConsultDate || input.course.startDate || "");
  DATE_FIELDS.forEach((fieldName) => setTextWithFontSize(form, fieldName, consultDate, 13));

  const sites = input.sites.slice().sort((left, right) => left.siteNumber - right.siteNumber);
  fillConsentSite(form, SITE_1_FIELDS, sites[0] ?? null);
  fillConsentSite(form, SITE_2_FIELDS, sites[1] ?? null);

  const documentIdentity = buildConsentDocumentIdentity(input.patient);

  return {
    bytes: await pdfDoc.save(),
    caption: documentIdentity.caption,
    fileName: documentIdentity.fileName
  };
}

export async function buildConsentUploadPdf(
  upload: StoredAssetUpload,
  patient: PatientRecord
) {
  const { mimeType, bytes } = decodeUploadDataUrl(upload);
  let pdfBytes = bytes;

  if (mimeType !== "application/pdf") {
    if (!mimeType.startsWith("image/")) {
      throw new Error("Consent upload must be a PDF or image.");
    }

    const pdfDoc = await PDFDocument.create();
    const image =
      mimeType === "image/png"
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    pdfBytes = await pdfDoc.save();
  }

  const documentIdentity = buildConsentDocumentIdentity(patient);

  return {
    bytes: pdfBytes,
    caption: documentIdentity.caption,
    fileName: documentIdentity.fileName
  };
}

export async function buildSignedConsentFormPdfFromTemplateBytes(
  templateBytes: Uint8Array,
  input: ConsentFormBuildInput & { signing: ConsentSigningInput }
) {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  setText(form, "Text Box 1", `${input.patient.firstName} ${input.patient.lastName}`.trim());
  setText(form, "Text Box 1_2", formatDisplayDate(input.patient.dob));
  setText(form, "Text Box 1_5", input.patient.mrn);
  const signDate = formatDisplayDate(input.signing.signDate || input.course.simConsultDate || input.course.startDate || "");
  const dateRects = DATE_FIELDS.map((fieldName) => getFieldRect(form, fieldName));
  DATE_FIELDS.forEach((fieldName) => setText(form, fieldName, ""));
  setText(
    form,
    INITIALS_FIELD,
    shouldIncludePregnancyInitials(input.patient) ? input.signing.patientInitials.trim().toUpperCase() : ""
  );
  setCheckbox(form, FORMER_RADIATION_ACKNOWLEDGMENT_FIELD, input.signing.formerRadiationAcknowledged);
  setCheckbox(form, MEDICAL_DEVICES_ACKNOWLEDGMENT_FIELD, input.signing.medicalDevicesAcknowledged);
  const patientPrintedNameRect = getFieldRect(form, PATIENT_PRINTED_NAME_FIELD);
  setText(form, PATIENT_PRINTED_NAME_FIELD, "");
  setText(form, WITNESS_SIGNATURE_FIELD, "");

  const sites = input.sites.slice().sort((left, right) => left.siteNumber - right.siteNumber);
  fillConsentSite(form, SITE_1_FIELDS, sites[0] ?? null);
  fillConsentSite(form, SITE_2_FIELDS, sites[1] ?? null);

  const patientSignatureRect = getFieldRect(form, PATIENT_SIGNATURE_FIELD);
  const witnessRect = getFieldRect(form, WITNESS_SIGNATURE_FIELD);
  form.flatten();

  const page = pdfDoc.getPages()[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  dateRects.forEach((rect) => {
    drawFittedText(page, font, signDate, rect, {
      paddingX: 6,
      maxSize: 11.5,
      minSize: 8.5,
      align: "center"
    });
  });

  drawFittedText(page, font, input.signing.patientPrintedName.trim(), patientPrintedNameRect, {
    paddingX: 10,
    maxSize: 12,
    minSize: 9,
    align: "center"
  });

  await drawSignatureImage(pdfDoc, page, input.signing.patientSignatureDataUrl, patientSignatureRect, {
    widthScale: 1.36,
    heightScale: 1.88,
    offsetX: 0,
    offsetY: patientSignatureRect.height * 0.02
  });

  const witnessSignatureRect = {
    x: witnessRect.x + witnessRect.width * 0.015,
    y: witnessRect.y + witnessRect.height * 0.1,
    width: witnessRect.width * 0.32,
    height: witnessRect.height * 0.76
  };
  await drawSignatureImage(pdfDoc, page, input.signing.witnessSignatureDataUrl, witnessSignatureRect, {
    widthScale: 1.18,
    heightScale: 1.58,
    offsetX: 0,
    offsetY: witnessSignatureRect.height * 0.01
  });

  const witnessName = ensureTherapistCredentials(input.signing.witnessPrintedName);
  const witnessNameRect = {
    x: witnessRect.x + witnessRect.width * 0.39,
    y: witnessRect.y + witnessRect.height * 0.08,
    width: witnessRect.width * 0.52,
    height: witnessRect.height * 0.7
  };
  drawFittedText(page, font, witnessName, witnessNameRect, {
    paddingX: 6,
    maxSize: 12,
    minSize: 8.5,
    align: "center"
  });

  const documentIdentity = buildConsentDocumentIdentity(input.patient);

  return {
    bytes: await pdfDoc.save(),
    caption: documentIdentity.caption,
    fileName: documentIdentity.fileName
  };
}
