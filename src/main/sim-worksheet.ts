import fs from "node:fs";
import path from "node:path";

import {
  buildSimWorksheetPdfFromTemplateBytes,
  type SimWorksheetBuildInput
} from "../shared/sim-worksheet-pdf";

const TEMPLATE_PATH = path.resolve(process.cwd(), "assets/templates/radiation-therapy-sim-worksheet.pdf");

function getWorksheetPdfBytes() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Sim worksheet template not found at ${TEMPLATE_PATH}.`);
  }

  return fs.readFileSync(TEMPLATE_PATH);
}

export async function buildSimWorksheetPdf(input: SimWorksheetBuildInput) {
  return buildSimWorksheetPdfFromTemplateBytes(getWorksheetPdfBytes(), input);
}
