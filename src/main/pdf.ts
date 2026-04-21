import { PDFDocument, PDFImage, StandardFonts, rgb } from "pdf-lib";

export interface PdfBinaryAssetInput {
  bytes: Uint8Array;
  fileName?: string;
  mimeType?: string;
}

export interface PdfPhotoInput {
  image: PdfBinaryAssetInput;
  caption: string;
  siteNumber?: 1 | 2;
}

export interface PdfAttachmentInput {
  file: PdfBinaryAssetInput;
  caption: string;
  mimeType?: string;
  originalName?: string;
}

export interface PdfBuildInput {
  noteText: string;
  photoInputs: PdfPhotoInput[];
  attachmentInputs: PdfAttachmentInput[];
  logoInput?: PdfBinaryAssetInput | null;
}

function wrapLine(
  text: string,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [""];
  }

  const lines: string[] = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  lines.push(current);
  return lines;
}

function scaleToFit(width: number, height: number, maxWidth: number, maxHeight: number) {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: width * ratio,
    height: height * ratio
  };
}

function getLogoPlacement(logo: PDFImage, variant: "brand" | "visit") {
  const aspectRatio = logo.width / Math.max(logo.height, 1);
  const isSquareish = aspectRatio <= 1.35;

  if (variant === "visit") {
    return isSquareish
      ? { maxWidth: 114, maxHeight: 100, yOffset: 8 }
      : { maxWidth: 158, maxHeight: 68, yOffset: 0 };
  }

  return isSquareish
    ? { maxWidth: 98, maxHeight: 86, yOffset: 6 }
    : { maxWidth: 124, maxHeight: 60, yOffset: 0 };
}

function getAssetExtension(input?: PdfBinaryAssetInput | null) {
  const fileName = input?.fileName ?? "";
  if (fileName) {
    const lastDot = fileName.lastIndexOf(".");
    return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : "";
  }

  const mimeType = input?.mimeType?.toLowerCase() ?? "";
  if (mimeType.includes("png")) {
    return ".png";
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return ".jpg";
  }

  if (mimeType.includes("pdf")) {
    return ".pdf";
  }

  return "";
}

async function embedRasterImage(pdfDoc: PDFDocument, imageInput?: PdfBinaryAssetInput | null) {
  if (!imageInput?.bytes?.length) {
    return null;
  }

  const imageBytes = imageInput.bytes;
  const extension = getAssetExtension(imageInput);
  if (extension === ".png") {
    return pdfDoc.embedPng(imageBytes);
  }

  return pdfDoc.embedJpg(imageBytes);
}

function splitFrontMatter(noteText: string) {
  const lines = noteText.split(/\r?\n/);
  if (/^[12]\s+Site Radiation Therapy/i.test(lines[0]?.trim() || "")) {
    lines.shift();
    while (lines[0] !== undefined && !lines[0].trim()) {
      lines.shift();
    }
  }

  const metadataLines: string[] = [];
  let bodyStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (!line.trim()) {
      bodyStartIndex = index + 1;
      break;
    }

    metadataLines.push(line);
    bodyStartIndex = index + 1;
  }

  return {
    metadataLines,
    bodyLines: lines.slice(bodyStartIndex)
  };
}

function splitLabelValue(line: string) {
  const match = line.match(/^([^:]{1,80}:)\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    label: match[1].trimEnd(),
    value: match[2] ?? ""
  };
}

function shouldBoldBodyLabel(label: string) {
  return label.trim() === "Plan:";
}

function parseDiagnosisHeading(line: string) {
  const match = line.trim().match(/^(\d+\.)\s+(.+?)\s+\(([^)]+)\)$/);
  if (!match) {
    return null;
  }

  return {
    indexLabel: match[1],
    diagnosis: match[2],
    icd10: `(${match[3]})`
  };
}

function drawDiagnosisHeading(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  line: string,
  y: number,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  margin: number
) {
  const parsed = parseDiagnosisHeading(line);
  if (!parsed) {
    return null;
  }

  const accent = rgb(0.24, 0.4, 0.67);
  const muted = rgb(0.48, 0.5, 0.55);
  const indexSize = 11;
  const diagnosisSize = 11.4;
  const icdSize = 9.4;
  const indexX = margin;
  const diagnosisX = margin + 18;
  const diagnosisY = y;
  const icdY = y - 10.5;

  drawSimpleLine(page, parsed.indexLabel, indexX, diagnosisY, indexSize, boldFont, accent);
  drawSimpleLine(page, parsed.diagnosis, diagnosisX, diagnosisY, diagnosisSize, boldFont, accent);
  drawSimpleLine(page, parsed.icd10, diagnosisX, icdY, icdSize, regularFont, muted);

  return icdY - 9.5;
}

function parseMetadataFields(metadataLines: string[]) {
  const fields = new Map<string, string>();

  for (const line of metadataLines) {
    const segments = line.split(/\s{2,}/).map((segment) => segment.trim()).filter(Boolean);
    const sourceSegments = segments.length ? segments : [line.trim()];

    for (const segment of sourceSegments) {
      const parsed = splitLabelValue(segment);
      if (!parsed) {
        continue;
      }
      fields.set(parsed.label.replace(/:$/, ""), parsed.value.trim());
    }
  }

  return {
    name: fields.get("Name") ?? "",
    sex: fields.get("Sex") ?? "",
    dob: fields.get("DOB") ?? "",
    mrn: fields.get("MRN") ?? "",
    date: fields.get("Today's Date") ?? fields.get("Date") ?? ""
  };
}

function formatLongDate(value: string) {
  if (!value) {
    return "";
  }

  const parts = value.split("/");
  if (parts.length === 3) {
    const [month, day, year] = parts.map((part) => Number(part));
    if (!Number.isNaN(month) && !Number.isNaN(day) && !Number.isNaN(year)) {
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
  }

  return value;
}

function getSegmentPositions(count: number, pageWidth: number, margin: number) {
  const usableWidth = pageWidth - margin * 2;
  if (count === 2) {
    return [margin, margin + usableWidth * 0.56];
  }

  if (count === 3) {
    return [margin, margin + usableWidth * 0.4, margin + usableWidth * 0.73];
  }

  if (count >= 4) {
    return [margin, margin + usableWidth * 0.28, margin + usableWidth * 0.54, margin + usableWidth * 0.78];
  }

  return [margin];
}

function drawSimpleLine(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  text: string,
  x: number,
  y: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  color: ReturnType<typeof rgb>
) {
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color
  });
}

function drawLabeledLine(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  line: string,
  y: number,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  x: number,
  maxWidth: number,
  color: ReturnType<typeof rgb>
) {
  const parsed = splitLabelValue(line.trim());
  if (!parsed || !parsed.value) {
    drawSimpleLine(page, line, x, y, size, regularFont, color);
    return;
  }

  const labelText = `${parsed.label} `;
  const labelWidth = boldFont.widthOfTextAtSize(labelText, size);
  drawSimpleLine(page, parsed.label, x, y, size, boldFont, color);

  const wrapped = wrapLine(parsed.value, Math.max(40, maxWidth - labelWidth - 2), regularFont, size);
  if (!wrapped.length) {
    return;
  }

  drawSimpleLine(page, wrapped[0], x + labelWidth + 2, y, size, regularFont, color);
}

function drawSegmentedLine(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  line: string,
  y: number,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  margin: number,
  color: ReturnType<typeof rgb>
) {
  const segments = line.split(/\s{2,}/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length <= 1) {
    drawLabeledLine(page, line, y, regularFont, boldFont, size, margin, page.getWidth() - margin * 2, color);
    return;
  }

  const positions = getSegmentPositions(segments.length, page.getWidth(), margin);
  segments.forEach((segment, index) => {
    const x = positions[Math.min(index, positions.length - 1)];
    drawLabeledLine(page, segment, y, regularFont, boldFont, size, x, page.getWidth() - margin - x, color);
  });
}

function drawWrappedParagraph(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  line: string,
  y: number,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  lineHeight: number,
  margin: number,
  color: ReturnType<typeof rgb>
) {
  const parsed = splitLabelValue(line.trim());
  if (!parsed || !parsed.value || !shouldBoldBodyLabel(parsed.label)) {
    const wrappedLines = wrapLine(line, page.getWidth() - margin * 2, regularFont, size);
    let nextY = y;
    for (const wrappedLine of wrappedLines) {
      drawSimpleLine(page, wrappedLine, margin, nextY, size, regularFont, color);
      nextY -= lineHeight;
    }
    return nextY;
  }

  const labelText = `${parsed.label} `;
  const labelWidth = boldFont.widthOfTextAtSize(labelText, size);
  const wrappedValues = wrapLine(parsed.value, Math.max(44, page.getWidth() - margin * 2 - labelWidth - 2), regularFont, size);
  let nextY = y;

  drawSimpleLine(page, parsed.label, margin, nextY, size, boldFont, color);

  if (wrappedValues.length) {
    drawSimpleLine(page, wrappedValues[0], margin + labelWidth + 2, nextY, size, regularFont, color);
    nextY -= lineHeight;
  } else {
    nextY -= lineHeight;
  }

  for (const wrappedLine of wrappedValues.slice(1)) {
    drawSimpleLine(page, wrappedLine, margin + labelWidth + 2, nextY, size, regularFont, color);
    nextY -= lineHeight;
  }

  return nextY;
}

function drawBrandHeader(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  logo: PDFImage | null,
  margin: number
) {
  const headerTop = page.getHeight() - 28;
  let contentTop = page.getHeight() - margin;

  if (logo) {
    const placement = getLogoPlacement(logo, "brand");
    const fitted = scaleToFit(logo.width, logo.height, placement.maxWidth, placement.maxHeight);
    const logoY = headerTop - fitted.height + placement.yOffset;
    page.drawImage(logo, {
      x: margin,
      y: logoY,
      width: fitted.width,
      height: fitted.height
    });
    contentTop = logoY - 8;
  }

  return contentTop;
}

function drawVisitPageHeader(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  logo: PDFImage | null,
  margin: number,
  metadata: ReturnType<typeof parseMetadataFields>,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>
) {
  const accent = rgb(0.17, 0.22, 0.42);
  const muted = rgb(0.4, 0.43, 0.5);
  const headerTop = page.getHeight() - 34;
  let logoBottomY = page.getHeight() - margin;

  if (logo) {
    const placement = getLogoPlacement(logo, "visit");
    const fitted = scaleToFit(logo.width, logo.height, placement.maxWidth, placement.maxHeight);
    const logoY = headerTop - fitted.height + placement.yOffset;
    page.drawImage(logo, {
      x: margin,
      y: logoY,
      width: fitted.width,
      height: fitted.height
    });
    logoBottomY = logoY;
  }

  const rightColumnWidth = 320;
  const rightColumnX = page.getWidth() - margin - rightColumnWidth;
  const patientName = metadata.name || "Patient";
  const patientNameSize = 22;
  const patientNameWidth = boldFont.widthOfTextAtSize(patientName, patientNameSize);
  page.drawText(patientName, {
    x: Math.max(rightColumnX, page.getWidth() - margin - patientNameWidth),
    y: headerTop - patientNameSize,
    size: patientNameSize,
    font: boldFont,
    color: accent
  });

  const infoY = headerTop - patientNameSize - 28;
  const fields = [
    { label: "Sex", value: metadata.sex },
    { label: "DOB", value: metadata.dob },
    { label: "MRN", value: metadata.mrn },
    { label: "Visit", value: formatLongDate(metadata.date) }
  ].filter((item) => item.value);

  const columnGap = 74;
  fields.forEach((field, index) => {
    const x = rightColumnX + index * columnGap;
    page.drawText(`${field.label}:`, {
      x,
      y: infoY,
      size: 9.5,
      font: regularFont,
      color: muted
    });
    page.drawText(field.value, {
      x,
      y: infoY - 16,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
  });

  const dividerY = Math.min(infoY - 36, logoBottomY - 12);
  page.drawRectangle({
    x: 0,
    y: dividerY,
    width: page.getWidth(),
    height: 6,
    color: rgb(0.92, 0.92, 0.94)
  });

  return dividerY - 22;
}

function findNextNonEmptyLine(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const value = lines[index]?.trim();
    if (value) {
      return { index, value };
    }
  }

  return null;
}

function isUnderlineLine(value: string) {
  return /^_+$/.test(value.trim());
}

function drawSignatureBlock(
  page: Awaited<ReturnType<PDFDocument["addPage"]>>,
  startY: number,
  heading: string,
  signerLine: string,
  regularFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  boldFont: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  margin: number,
  color: ReturnType<typeof rgb>
) {
  const headingSize = 10.6;
  const bodySize = 10.2;
  const lineThickness = 1;
  const signatureLineWidth = 300;
  const dateLineWidth = 118;
  const labelGap = 6;
  const signerGap = 16;
  const blockTopGap = 34;
  const signatureX = margin;
  const signatureLineY = startY - blockTopGap;
  const signatureLabelY = signatureLineY - 16;
  const signerLineY = signatureLabelY - signerGap;
  const dateX = page.getWidth() - margin - dateLineWidth - 18;
  const dateLineY = signatureLineY;
  const dateLabelY = dateLineY - 16;

  drawSimpleLine(page, heading, margin, startY, headingSize, boldFont, color);

  page.drawLine({
    start: { x: signatureX, y: signatureLineY },
    end: { x: signatureX + signatureLineWidth, y: signatureLineY },
    thickness: lineThickness,
    color
  });

  page.drawLine({
    start: { x: dateX, y: dateLineY },
    end: { x: dateX + dateLineWidth, y: dateLineY },
    thickness: lineThickness,
    color
  });

  drawSimpleLine(page, "Physician Signature", signatureX, signatureLabelY, bodySize, regularFont, color);
  drawSimpleLine(page, signerLine, signatureX, signerLineY, bodySize, regularFont, color);
  drawSimpleLine(page, "Date", dateX, dateLabelY, bodySize, regularFont, color);

  return signerLineY - 26;
}

export async function buildVisitPdf({ noteText, photoInputs, attachmentInputs, logoInput }: PdfBuildInput) {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedRasterImage(pdfDoc, logoInput);
  const pageSize: [number, number] = [612, 792];
  const margin = 40;
  const metadataLineHeight = 15;
  const bodyLineHeight = 12.5;
  const metadataSize = 11;
  const sectionSize = 10.6;
  const bodySize = 10.2;
  const textColor = rgb(0, 0, 0);
  const { metadataLines, bodyLines } = splitFrontMatter(noteText);
  const metadata = parseMetadataFields(metadataLines);

  let page = pdfDoc.addPage(pageSize);
  let cursorY = drawVisitPageHeader(page, logo, margin, metadata, regularFont, boldFont);

  for (let lineIndex = 0; lineIndex < bodyLines.length; lineIndex += 1) {
    const rawLine = bodyLines[lineIndex];
    const cleanLine = rawLine.trimEnd();
    if (!cleanLine.trim()) {
      cursorY -= 5;
      if (cursorY < margin + bodyLineHeight) {
        page = pdfDoc.addPage(pageSize);
        cursorY = drawVisitPageHeader(page, logo, margin, metadata, regularFont, boldFont);
      }
      continue;
    }

    if (cleanLine === "Supervised by:" || cleanLine === "Treatment Supervised by:") {
      const firstUnderline = findNextNonEmptyLine(bodyLines, lineIndex + 1);
      if (firstUnderline && isUnderlineLine(firstUnderline.value)) {
        const signatureMarker = findNextNonEmptyLine(bodyLines, firstUnderline.index + 1);
        const signerEntry = signatureMarker ? findNextNonEmptyLine(bodyLines, signatureMarker.index + 1) : null;
        const secondUnderline = signerEntry ? findNextNonEmptyLine(bodyLines, signerEntry.index + 1) : null;
        const dateEntry = secondUnderline ? findNextNonEmptyLine(bodyLines, secondUnderline.index + 1) : null;

        if (signatureMarker?.value === "Physician Signature" && signerEntry && secondUnderline && isUnderlineLine(secondUnderline.value) && dateEntry?.value === "Date") {
          const minimumBlockSpace = 108;
          if (cursorY < margin + minimumBlockSpace) {
            page = pdfDoc.addPage(pageSize);
            cursorY = drawVisitPageHeader(page, logo, margin, metadata, regularFont, boldFont);
          }

          cursorY = drawSignatureBlock(
            page,
            cursorY,
            cleanLine,
            signerEntry.value,
            regularFont,
            boldFont,
            margin,
            textColor
          );
          lineIndex = dateEntry.index;
          continue;
        }
      }
    }

    if (cleanLine.endsWith(":")) {
      const wrappedHeadingLines = wrapLine(cleanLine, page.getWidth() - margin * 2, boldFont, sectionSize);
      for (const wrappedHeadingLine of wrappedHeadingLines) {
        if (cursorY < margin + bodyLineHeight * 2) {
          page = pdfDoc.addPage(pageSize);
          cursorY = drawVisitPageHeader(page, logo, margin, metadata, regularFont, boldFont);
        }

        drawSimpleLine(page, wrappedHeadingLine, margin, cursorY, sectionSize, boldFont, textColor);
        cursorY -= bodyLineHeight;
      }
      cursorY -= 1.5;
      continue;
    }

    const diagnosisHeadingY = drawDiagnosisHeading(
      page,
      cleanLine,
      cursorY,
      regularFont,
      boldFont,
      margin
    );
    if (diagnosisHeadingY !== null) {
      cursorY = diagnosisHeadingY;
      continue;
    }

    if (cursorY < margin + bodyLineHeight * 2) {
      page = pdfDoc.addPage(pageSize);
      cursorY = drawVisitPageHeader(page, logo, margin, metadata, regularFont, boldFont);
    }

    cursorY = drawWrappedParagraph(
      page,
      cleanLine,
      cursorY,
      regularFont,
      boldFont,
      bodySize,
      bodyLineHeight,
      margin,
      textColor
    );
  }

  if (photoInputs.length > 0) {
    const COLS = 2;
    const ROWS = 3;
    const PER_PAGE = COLS * ROWS;
    const colGap = 10;
    const rowGap = 8;
    const captionH = 13;

    // Pre-embed all images
    const embedded: Array<{ img: Awaited<ReturnType<typeof embedRasterImage>>; input: PdfPhotoInput }> = [];
    for (const photoInput of photoInputs) {
      embedded.push({ img: await embedRasterImage(pdfDoc, photoInput.image), input: photoInput });
    }

    // Group by siteNumber
    const siteNums = [...new Set(embedded.map((e) => e.input.siteNumber ?? 1))].sort() as (1 | 2)[];
    const isTwoSite = siteNums.length > 1;

    for (const siteNum of siteNums) {
      const group = embedded.filter((e) => (e.input.siteNumber ?? 1) === siteNum && e.img !== null);
      if (group.length === 0) continue;
      const sectionLabel = isTwoSite ? `Lesion ${siteNum} Photos` : "Other Photos";

      for (let pageStart = 0; pageStart < group.length; pageStart += PER_PAGE) {
        const pageGroup = group.slice(pageStart, pageStart + PER_PAGE);
        const photoPage = pdfDoc.addPage(pageSize);
        const headerY = drawBrandHeader(photoPage, logo, margin);
        const labelText = pageStart === 0 ? sectionLabel : `${sectionLabel} (cont.)`;
        drawSimpleLine(photoPage, labelText, margin, headerY, 11, boldFont, textColor);

        const gridTop = headerY - 18;
        const availH = gridTop - margin;
        const rowH = (availH - (ROWS - 1) * rowGap) / ROWS;
        const colW = (pageSize[0] - margin * 2 - (COLS - 1) * colGap) / COLS;
        const photoH = rowH - captionH - 4;

        for (let i = 0; i < pageGroup.length; i++) {
          const { img, input } = pageGroup[i];
          if (!img) continue;
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const cellX = margin + col * (colW + colGap);
          const cellTopY = gridTop - row * (rowH + rowGap);
          const caption = input.caption || input.image.fileName || "Photo";
          drawSimpleLine(photoPage, caption, cellX, cellTopY, captionH - 1, regularFont, textColor);
          const fitted = scaleToFit(img.width, img.height, colW, photoH);
          const imgX = cellX + (colW - fitted.width) / 2;
          const imgY = cellTopY - captionH - 4 - fitted.height;
          photoPage.drawImage(img, { x: imgX, y: imgY, width: fitted.width, height: fitted.height });
        }
      }
    }
  }

  for (const attachmentInput of attachmentInputs) {
    const extension = getAssetExtension(attachmentInput.file);
    if (extension === ".pdf") {
      const attachmentDoc = await PDFDocument.load(attachmentInput.file.bytes);
      const copiedPages = await pdfDoc.copyPages(attachmentDoc, attachmentDoc.getPageIndices());
      copiedPages.forEach((copiedPage) => pdfDoc.addPage(copiedPage));
      continue;
    }

    const image = await embedRasterImage(pdfDoc, attachmentInput.file);
    if (!image) {
      continue;
    }

    const attachmentPage = pdfDoc.addPage(pageSize);
    const attachmentHeaderY = drawBrandHeader(attachmentPage, logo, margin);
    const caption = attachmentInput.caption || attachmentInput.originalName || attachmentInput.file.fileName || "Attachment";
    drawSimpleLine(attachmentPage, caption, margin, attachmentHeaderY, 11, boldFont, textColor);

    const fitted = scaleToFit(
      image.width,
      image.height,
      attachmentPage.getWidth() - margin * 2,
      attachmentHeaderY - margin - 24
    );
    const x = (attachmentPage.getWidth() - fitted.width) / 2;
    const y = Math.max(margin, attachmentHeaderY - 16 - fitted.height);

    attachmentPage.drawImage(image, {
      x,
      y,
      width: fitted.width,
      height: fitted.height
    });
  }

  return pdfDoc.save();
}
