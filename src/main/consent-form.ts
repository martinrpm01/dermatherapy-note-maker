import fs from "node:fs";
import path from "node:path";

import {
  buildConsentUploadPdf,
  buildSignedConsentFormPdfFromTemplateBytes,
  buildConsentFormPdfFromTemplateBytes,
  type ConsentFormBuildInput
} from "../shared/consent-form-pdf";
import type { ConsentSigningInput, PatientRecord, StoredAssetUpload } from "../shared/types";

const TEMPLATE_PATH = path.resolve(process.cwd(), "assets/templates/radiation-therapy-consent-form.pdf");

function getConsentFormPdfBytes() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Consent form template not found at ${TEMPLATE_PATH}.`);
  }

  return fs.readFileSync(TEMPLATE_PATH);
}

export async function buildConsentFormPdf(input: ConsentFormBuildInput) {
  return buildConsentFormPdfFromTemplateBytes(getConsentFormPdfBytes(), input);
}

export async function buildUploadedConsentPdf(upload: StoredAssetUpload, patient: PatientRecord) {
  return buildConsentUploadPdf(upload, patient);
}

export async function buildSignedConsentFormPdf(
  input: ConsentFormBuildInput & { signing: ConsentSigningInput }
) {
  return buildSignedConsentFormPdfFromTemplateBytes(getConsentFormPdfBytes(), input);
}
