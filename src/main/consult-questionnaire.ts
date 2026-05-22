import fs from "node:fs";
import path from "node:path";

import {
  buildConsultQuestionnairePdfFromTemplateBytes,
  type ConsultQuestionnaireBuildInput
} from "../shared/consult-questionnaire-pdf";

const TEMPLATE_PATH = path.resolve(process.cwd(), "assets/templates/radiation-therapy-consult-questionnaire.pdf");

function getConsultQuestionnaireTemplateBytes() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Consult questionnaire template not found at ${TEMPLATE_PATH}.`);
  }
  return fs.readFileSync(TEMPLATE_PATH);
}

export async function buildConsultQuestionnairePdf(input: ConsultQuestionnaireBuildInput) {
  return buildConsultQuestionnairePdfFromTemplateBytes(getConsultQuestionnaireTemplateBytes(), input);
}
