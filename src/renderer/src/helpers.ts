import {
  applyAutomaticDoseValuesToSiteSnapshot,
  applyAutoNumberOfBlocks,
  buildShieldSummary,
  buildSimulationComplicationLine,
  buildSimulationComplicationText,
  buildTreatmentDeliveryStatement,
  calculateAgeAtDate,
  formatAdditionalDevicesForSite,
  formatDisplayDate,
  formatVitals,
  getAutoNumberOfBlocks,
  getDefaultFinalTreatmentNote,
  getDefaultMipsNote,
  getDefaultPhysicsComment,
  getMaxSitePrescribedFractions,
  isFinalTreatmentEligible,
  normalizeVacLokAreaValue,
  normalizeWorksheetDeviceDetailsForSite,
  normalizeVacLokPlacement,
  normalizeCutoutSizeLabel,
  normalizeInlineSectionText,
  normalizePostCareText,
  normalizeTreatmentComment,
  stripExamVitalsSection
} from "../../shared/note-rules";
import { renderTemplate } from "../../shared/template-engine";
import type {
  AssetReference,
  AppSettingsView,
  CourseDetail,
  CourseInput,
  PatientInput,
  PatientRecord,
  TemplateDefinitionRecord,
  TreatmentCourseRecord,
  VisitInput
} from "../../shared/types";

const DEFAULT_TREATMENT_MACHINE = "Xoft Elekta 1200 SPX";
const DEFAULT_TREATMENT_DEPTH = "3";

function formatMeasurement(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalized.toLowerCase() === "open cone" || normalized.toLowerCase() === "none") {
    return "Open Cone";
  }

  const mmMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return `${mmMatch[1]}mm`;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}mm`;
  }

  return normalized;
}

function getDefaultMachine(value: string) {
  return value.trim() || DEFAULT_TREATMENT_MACHINE;
}

function getDefaultTreatmentDepth(value: string) {
  return value.trim() || DEFAULT_TREATMENT_DEPTH;
}

function buildFinalTreatmentSection(enabled: boolean, value?: string) {
  if (!enabled) {
    return "";
  }

  return `${value?.trim() || getDefaultFinalTreatmentNote()}\n`;
}

function buildMipsSection(enabled: boolean, value?: string) {
  if (!enabled) {
    return "";
  }

  return `Plan: MIPS\n${value?.trim() || getDefaultMipsNote()}\n`;
}

function injectFinalTreatmentSection(renderedText: string, finalTreatmentSection: string) {
  const trimmedSection = finalTreatmentSection.trim();
  if (!trimmedSection) {
    return renderedText;
  }

  if (renderedText.includes(trimmedSection)) {
    return renderedText;
  }

  if (!renderedText.includes("Follow Up:")) {
    return renderedText;
  }

  return renderedText.replace("Follow Up:", `${trimmedSection}\n\nFollow Up:`);
}

function injectMipsSection(renderedText: string, mipsSection: string) {
  const trimmedSection = mipsSection.trim();
  if (!trimmedSection) {
    return renderedText;
  }

  const legacySection = trimmedSection.replace(/^Plan: MIPS\r?\n/, "MIPS:\n");
  const cleanedText = renderedText
    .replaceAll(trimmedSection, "")
    .replaceAll(legacySection, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  for (const marker of ["Treatment Supervised by:", "Supervised by:"]) {
    if (cleanedText.includes(marker)) {
      return cleanedText.replace(marker, `${trimmedSection}\n\n${marker}`);
    }
  }

  return `${cleanedText}\n\n${trimmedSection}`;
}

function formatPhysicsFractionRange(treatmentNumber: number | null) {
  if (treatmentNumber === null || treatmentNumber <= 0) {
    return "";
  }

  const end = Math.trunc(treatmentNumber);
  const start = Math.max(1, end - 4);
  return `${start} to ${end}`;
}

function injectPhysicsConsultationDetails(
  renderedText: string,
  physicsComment: string,
  bodyLocations: string[],
  treatmentNumber: number | null
) {
  const trimmedComment = physicsComment.trim();
  if (!trimmedComment && bodyLocations.every((location) => !location.trim())) {
    return renderedText;
  }

  const commentFirstLine = trimmedComment.split("\n")[0]?.trim() ?? "";
  const lines = renderedText.split("\n");
  let consultationIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("Physics Consultation:")) {
      continue;
    }

    const bodyLocation = bodyLocations[consultationIndex]?.trim() ?? "";
    const fractionRange = formatPhysicsFractionRange(treatmentNumber);
    lines[index] = line.replace(/ for .+$/, "");
    if (fractionRange) {
      lines[index] = lines[index].replace(/Fraction Number:.+$/, `Fraction Number: ${fractionRange}`);
    }
    if (bodyLocation) {
      const locationLine = `Location: ${bodyLocation}`;
      const previousLine = (lines[index - 1] ?? "").trim();
      if (previousLine.startsWith("Location:")) {
        lines[index - 1] = locationLine;
      } else {
        lines.splice(index, 0, locationLine);
        index += 1;
      }
    }

    if (trimmedComment && commentFirstLine) {
      const nextLine = (lines[index + 1] ?? "").trim();
      if (nextLine !== commentFirstLine) {
        lines.splice(index + 1, 0, trimmedComment);
        index += trimmedComment.split("\n").length;
      }
    }

    consultationIndex += 1;
  }

  return lines.join("\n");
}

function buildFlexShieldCutoutText(cutoutSize: string, coneSize: string) {
  const cutoutDisplay = formatMeasurement(cutoutSize);
  const coneDisplay = formatMeasurement(coneSize);
  const openCone = cutoutDisplay === "Open Cone";

  if (openCone) {
    return coneDisplay ? `Open ${coneDisplay} Cone` : "Open Cone";
  }

  if (cutoutDisplay && coneDisplay) {
    return `${cutoutDisplay}, to be used with a ${coneDisplay} cone`;
  }

  return cutoutDisplay || "";
}

export function toFileUrl(targetPath: string | null | undefined) {
  if (!targetPath) {
    return null;
  }

  if (targetPath.startsWith("file://")) {
    return targetPath;
  }

  return `file:///${targetPath.replace(/\\/g, "/")}`;
}

export function toAssetUrl(asset: AssetReference | null | undefined) {
  if (!asset) {
    return null;
  }

  return `asset://local/${asset.assetId}`;
}

export function buildVisitPreviewText(
  templates: TemplateDefinitionRecord[],
  patient: PatientRecord,
  course: TreatmentCourseRecord,
  note: VisitInput,
  settings?: AppSettingsView | null
) {
  const template = templates.find((item) => item.key === `${course.courseType}:${note.noteType}`);
  if (!template) {
    return note.editedText || note.generatedText;
  }

  const emptySite = (siteNumber: 1 | 2) => ({
    siteNumber,
    bodyLocation: "",
    treatmentLocationText: "",
    diagnosisText: "",
    icd10: "",
    numberOfBlocks: 1,
    lesionSize: "",
    treatmentDepth: DEFAULT_TREATMENT_DEPTH,
    coneSize: "",
    cutoutSize: "",
    shields: "",
    machine: DEFAULT_TREATMENT_MACHINE,
    energyKv: "",
    treatmentInterval: "",
    additionalDevices: "",
    dailyDose: 0,
    totalDose: 0,
    cumulativeDose: 0,
    prescribedFractions: undefined
  });

  const normalizedSites = applyAutoNumberOfBlocks(note.noteType, note.structuredFields.siteSnapshots);
  const site1Base = normalizedSites.find((site) => site.siteNumber === 1) || emptySite(1);
  const site2Base = normalizedSites.find((site) => site.siteNumber === 2) || emptySite(2);
  const projectedFractionsInput = note.structuredFields.projectedFractionsInput ?? null;
  const courseFractions = course.prescribedFractions > 0 ? course.prescribedFractions : null;
  const renderedCourseFractions =
    courseFractions ??
    getMaxSitePrescribedFractions(normalizedSites) ??
    note.structuredFields.prescribedFractionsInput ??
    (note.noteType === "consult_sim" ? projectedFractionsInput : null);
  const getTxSiteName = (site: typeof site1Base) => site.treatmentLocationText.trim() || site.bodyLocation.trim();
  const getTotalFractionValue = (site: typeof site1Base) =>
    site.prescribedFractions ?? (note.noteType === "consult_sim" ? projectedFractionsInput : null) ?? courseFractions;
  const getTotalFractions = (site: typeof site1Base) => {
    const fractions = getTotalFractionValue(site);
    return fractions && fractions > 0 ? fractions : "";
  };
  const getRenderableSite = (site: typeof site1Base) =>
    note.noteType === "consult_sim"
      ? applyAutomaticDoseValuesToSiteSnapshot(site, null, getTotalFractionValue(site))
      : site;
  const getCumulativeDose = (site: typeof site1Base) => {
    if (site.cumulativeDose > 0) {
      return site.cumulativeDose;
    }
    return note.noteType === "consult_sim" ? 0 : "";
  };
  const site1RenderBase = getRenderableSite(site1Base);
  const site2RenderBase = getRenderableSite(site2Base);
  const site1 = {
    ...site1RenderBase,
    biopsyDate: formatDisplayDate(site1RenderBase.biopsyDate || note.structuredFields.biopsyDate),
    txSiteName: getTxSiteName(site1RenderBase),
    dailyDose: site1RenderBase.dailyDose > 0 ? site1RenderBase.dailyDose : "",
    totalDose: site1RenderBase.totalDose > 0 ? site1RenderBase.totalDose : "",
    cumulativeDose: getCumulativeDose(site1RenderBase),
    prescribedFractions: (site1RenderBase.prescribedFractions ?? course.prescribedFractions) > 0
      ? (site1RenderBase.prescribedFractions ?? course.prescribedFractions)
      : "",
    totalFractions: getTotalFractions(site1RenderBase),
    cutoutSize: normalizeCutoutSizeLabel(site1RenderBase.cutoutSize),
    shields: buildShieldSummary(site1RenderBase.shields, site1RenderBase.additionalDevices),
    machine: getDefaultMachine(site1RenderBase.machine),
    treatmentDepth: getDefaultTreatmentDepth(site1RenderBase.treatmentDepth),
    coneSizeDisplay: formatMeasurement(site1RenderBase.coneSize),
    cutoutSizeDisplay: formatMeasurement(normalizeCutoutSizeLabel(site1RenderBase.cutoutSize)),
    flexShieldCutoutText: buildFlexShieldCutoutText(site1RenderBase.cutoutSize, site1RenderBase.coneSize),
    lesionSizeDisplay: formatMeasurement(site1RenderBase.lesionSize),
    treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site1RenderBase.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site1RenderBase.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site1RenderBase.additionalDevices),
        additionalDevices: formatAdditionalDevicesForSite(site1RenderBase)
    };
  const site2 = {
    ...site2RenderBase,
    biopsyDate: formatDisplayDate(site2RenderBase.biopsyDate || note.structuredFields.biopsyDate),
    txSiteName: getTxSiteName(site2RenderBase),
    dailyDose: site2RenderBase.dailyDose > 0 ? site2RenderBase.dailyDose : "",
    totalDose: site2RenderBase.totalDose > 0 ? site2RenderBase.totalDose : "",
    cumulativeDose: getCumulativeDose(site2RenderBase),
    prescribedFractions: (site2RenderBase.prescribedFractions ?? course.prescribedFractions) > 0
      ? (site2RenderBase.prescribedFractions ?? course.prescribedFractions)
      : "",
    totalFractions: getTotalFractions(site2RenderBase),
    cutoutSize: normalizeCutoutSizeLabel(site2RenderBase.cutoutSize),
    shields: buildShieldSummary(site2RenderBase.shields, site2RenderBase.additionalDevices),
    machine: getDefaultMachine(site2RenderBase.machine),
    treatmentDepth: getDefaultTreatmentDepth(site2RenderBase.treatmentDepth),
    coneSizeDisplay: formatMeasurement(site2RenderBase.coneSize),
    cutoutSizeDisplay: formatMeasurement(normalizeCutoutSizeLabel(site2RenderBase.cutoutSize)),
    flexShieldCutoutText: buildFlexShieldCutoutText(site2RenderBase.cutoutSize, site2RenderBase.coneSize),
    lesionSizeDisplay: formatMeasurement(site2RenderBase.lesionSize),
    treatmentDepthDisplay: formatMeasurement(getDefaultTreatmentDepth(site2RenderBase.treatmentDepth)),
      simulationComplications: buildSimulationComplicationText(site2RenderBase.additionalDevices),
      simulationComplicationsLine: buildSimulationComplicationLine(site2RenderBase.additionalDevices),
        additionalDevices: formatAdditionalDevicesForSite(site2RenderBase)
      };

  const finalTreatmentSection = buildFinalTreatmentSection(
    !!note.structuredFields.finalTreatment,
    note.structuredFields.finalTreatmentNote
  );
  const mipsSection = buildMipsSection(!!note.structuredFields.addMips, note.structuredFields.mipsNote);
  const treatmentDeliveryStatement = buildTreatmentDeliveryStatement(note.noteType, normalizedSites);

  const renderedText = renderTemplate(template.templateText, {
    patient: {
      fullName: `${patient.firstName} ${patient.lastName}`.trim(),
      mrn: patient.mrn,
      dob: formatDisplayDate(patient.dob),
      sex: patient.sex,
      sexLower: patient.sex ? patient.sex.toLowerCase() : "patient",
      age: calculateAgeAtDate(patient.dob, note.visitDate)
    },
    visit: {
      date: formatDisplayDate(note.visitDate),
      noteTypeLabel: note.noteType,
      treatmentNumber: note.treatmentNumber ?? "",
      therapistName: note.therapistName ? `${note.therapistName} RT(T)` : ""
    },
    course: {
      prescribedFractions: renderedCourseFractions && renderedCourseFractions > 0 ? renderedCourseFractions : ""
    },
    settings: {
      supervisingPhysician: settings?.supervisingPhysician ?? "",
      dermatologyOfficeName: settings?.dermatologyOfficeName ?? ""
    },
    site1,
    site2,
    vitals: formatVitals(note.vitals),
    structured: {
      ...note.structuredFields,
      additionalNotesSection: note.structuredFields.additionalNotes.trim()
        ? `Additional Notes: ${note.structuredFields.additionalNotes.trim()}\n`
        : "",
      finalTreatmentSection,
      mipsSection,
      postCare: normalizePostCareText(note.structuredFields.postCare),
      treatmentComment: normalizeTreatmentComment(note.structuredFields.treatmentComment),
      treatmentDeliveryStatement,
      ultrasoundPerformed: normalizeInlineSectionText(note.structuredFields.ultrasoundPerformed),
      startRadiationDate: formatDisplayDate(note.structuredFields.startRadiationDate),
      biopsyDate: formatDisplayDate(note.structuredFields.biopsyDate),
      lastTreatmentDate: formatDisplayDate(note.structuredFields.lastTreatmentDate),
    }
  });

  return stripExamVitalsSection(
    injectMipsSection(
      injectFinalTreatmentSection(
        injectPhysicsConsultationDetails(renderedText, note.structuredFields.physicsComment?.trim() || getDefaultPhysicsComment(note.noteType), [
          site1.bodyLocation,
          site2.bodyLocation
        ], note.treatmentNumber),
        finalTreatmentSection
      ),
      mipsSection
    ),
    note.noteType,
    note.structuredFields.includeExamVitals
  );
}

export function createEmptyPatientForm(): PatientInput {
  return {
    firstName: "",
    lastName: "",
    mrn: "",
    dob: "",
    sex: "",
    notes: ""
  };
}

export function createEmptyCourseForm(patientId: string): CourseInput {
  return {
    patientId,
    courseName: "",
    courseType: "one_site",
    prescribedFractions: 0,
    startDate: new Date().toISOString().slice(0, 10),
    simConsultDate: "",
    sites: [
      {
        siteNumber: 1,
        bodyLocation: "",
        treatmentLocationText: "",
        diagnosisText: "",
        biopsyDate: new Date().toISOString().slice(0, 10),
        icd10: "",
        numberOfBlocks: 0,
        lesionSize: "",
        treatmentDepth: "3",
        coneSize: "",
        cutoutSize: "",
        shields: "",
        machine: DEFAULT_TREATMENT_MACHINE,
        energyKv: "50kV",
        treatmentInterval: "bi-weekly",
          additionalDevices: "None",
            worksheetSide: "",
            worksheetPositioning: "",
            worksheetVacLokArea: "",
            worksheetEyeShieldType: "",
            worksheetGumShieldPosition: "",
            worksheetLipShieldPosition: "",
            dailyDose: 0,
            totalDose: 0
        }
      ]
  };
}

export function createEmptyConsentCourseForm(patientId: string): CourseInput {
  return {
    ...createEmptyCourseForm(patientId),
    simConsultDate: new Date().toISOString().slice(0, 10),
    status: "pending"
  };
}

export function createCourseFormFromDetail(courseDetail: CourseDetail): CourseInput {
  const fallback = createEmptyCourseForm(courseDetail.course.patientId);
  const fallbackSite = fallback.sites[0];
  const sites = courseDetail.sites.length
      ? courseDetail.sites.map((site) => ({
          ...normalizeVacLokPlacement(site.additionalDevices, site.worksheetPositioning),
          ...normalizeWorksheetDeviceDetailsForSite({
            additionalDevices: site.additionalDevices,
            worksheetEyeShieldType: site.worksheetEyeShieldType,
            worksheetGumShieldPosition: site.worksheetGumShieldPosition,
            worksheetLipShieldPosition: site.worksheetLipShieldPosition
          }),
          id: site.id,
          siteNumber: site.siteNumber,
          bodyLocation: site.bodyLocation,
          treatmentLocationText: site.treatmentLocationText,
        biopsyDate: site.biopsyDate ?? courseDetail.course.startDate,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", site.cutoutSize),
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth?.trim() ? site.treatmentDepth : fallbackSite.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: normalizeCutoutSizeLabel(site.cutoutSize),
        shields: site.shields,
        machine: site.machine?.trim() ? site.machine : fallbackSite.machine,
          energyKv: site.energyKv,
          treatmentInterval: site.treatmentInterval,
          worksheetSide: site.worksheetSide,
          worksheetVacLokArea: normalizeVacLokAreaValue(site.worksheetVacLokArea),
          dailyDose: site.dailyDose,
          totalDose: site.totalDose,
          prescribedFractions: site.prescribedFractions ?? courseDetail.course.prescribedFractions
        }))
    : fallback.sites;

  return {
    id: courseDetail.course.id,
    patientId: courseDetail.course.patientId,
    courseName: courseDetail.course.courseName,
    courseType: courseDetail.course.courseType,
    prescribedFractions: courseDetail.course.prescribedFractions > 0 ? courseDetail.course.prescribedFractions : 0,
    startDate: courseDetail.course.startDate,
    simConsultDate: courseDetail.course.simConsultDate ?? "",
    endDate: courseDetail.course.endDate,
    status: courseDetail.course.status,
    sites
  };
}

export async function fileToCompressedUpload(file: File, maxDimension: number, caption?: string, preferredMimeType?: string) {
  const imageBitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(imageBitmap.width, imageBitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
  canvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create image canvas.");
  }

  context.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
  const mimeType = preferredMimeType || file.type || "image/jpeg";
  const quality = mimeType === "image/png" ? undefined : 0.86;
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return {
    name: file.name,
    mimeType,
    dataUrl,
    caption
  };
}

export async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export async function cropImageFileToUpload(
  file: File,
  cropRect: { x: number; y: number; width: number; height: number },
  outputSize: { width: number; height: number },
  caption?: string,
  preferredMimeType?: string
) {
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outputSize.width));
  canvas.height = Math.max(1, Math.round(outputSize.height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create image canvas.");
  }

  const clampedX = Math.max(0, Math.min(cropRect.x, imageBitmap.width));
  const clampedY = Math.max(0, Math.min(cropRect.y, imageBitmap.height));
  const clampedWidth = Math.max(1, Math.min(cropRect.width, imageBitmap.width - clampedX));
  const clampedHeight = Math.max(1, Math.min(cropRect.height, imageBitmap.height - clampedY));

  context.drawImage(
    imageBitmap,
    clampedX,
    clampedY,
    clampedWidth,
    clampedHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const mimeType = preferredMimeType || file.type || "image/png";
  const quality = mimeType === "image/png" ? undefined : 0.92;
  const dataUrl = canvas.toDataURL(mimeType, quality);
  imageBitmap.close?.();
  return {
    name: file.name,
    mimeType,
    dataUrl,
    caption
  };
}

export async function renderImageFileToUpload(
  file: File,
  placement: { x: number; y: number; width: number; height: number },
  outputSize: { width: number; height: number },
  caption?: string,
  preferredMimeType?: string,
  options?: { trimWhitespace?: boolean; backgroundColor?: string | null }
) {
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outputSize.width));
  canvas.height = Math.max(1, Math.round(outputSize.height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create image canvas.");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  if (options?.backgroundColor) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(
    imageBitmap,
    0,
    0,
    imageBitmap.width,
    imageBitmap.height,
    placement.x,
    placement.y,
    placement.width,
    placement.height
  );

  let exportCanvas = canvas;
  if (options?.trimWhitespace) {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const isVisible = alpha > 16;
        const isNearWhite = red >= 248 && green >= 248 && blue >= 248;
        if (!isVisible || isNearWhite) {
          continue;
        }

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX >= minX && maxY >= minY) {
      const padding = Math.max(10, Math.round(Math.min(width, height) * 0.035));
      const trimmedX = Math.max(0, minX - padding);
      const trimmedY = Math.max(0, minY - padding);
      const trimmedWidth = Math.min(width - trimmedX, (maxX - minX + 1) + (padding * 2));
      const trimmedHeight = Math.min(height - trimmedY, (maxY - minY + 1) + (padding * 2));
      const trimmedCanvas = document.createElement("canvas");
      trimmedCanvas.width = Math.max(1, trimmedWidth);
      trimmedCanvas.height = Math.max(1, trimmedHeight);
      const trimmedContext = trimmedCanvas.getContext("2d");
      if (!trimmedContext) {
        throw new Error("Could not create trimmed image canvas.");
      }
      trimmedContext.drawImage(
        canvas,
        trimmedX,
        trimmedY,
        trimmedWidth,
        trimmedHeight,
        0,
        0,
        trimmedWidth,
        trimmedHeight
      );
      exportCanvas = trimmedCanvas;
    }
  }

  const mimeType = preferredMimeType || file.type || "image/png";
  const quality = mimeType === "image/png" ? undefined : 0.92;
  const dataUrl = exportCanvas.toDataURL(mimeType, quality);
  imageBitmap.close?.();
  return {
    name: file.name,
    mimeType,
    dataUrl,
    caption
  };
}

export async function fileToUpload(file: File, caption?: string) {
  const dataUrl = await readFileAsDataUrl(file);

  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl,
    caption
  };
}
