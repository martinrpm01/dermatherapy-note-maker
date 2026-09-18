import fs from "node:fs";
import path from "node:path";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildVisitPdf, formatVisitPdfPageNumber } from "../src/main/pdf";

const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sQ1ko4AAAAASUVORK5CYII=";

function dataUrlBytes(dataUrl: string) {
  return Uint8Array.from(Buffer.from(dataUrl.split(",")[1], "base64"));
}

type TextPosition = { page: number; text: string; x: number; y: number };

async function readTextPositions(pdfBytes: Uint8Array) {
  const pdf = await PDFDocument.load(pdfBytes);
  const positions: TextPosition[] = [];
  pdf.getPages().forEach((page, pageIndex) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((entry) => pdf.context.lookup(entry))
      : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const decoded = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const block of decoded.matchAll(/BT\s([\s\S]*?)\sET/g)) {
        const matrix = block[1].match(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/);
        if (!matrix) continue;
        const text = [...block[1].matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
          .map((match) => Buffer.from(match[1], "hex").toString("latin1")).join("");
        if (text) positions.push({ page: pageIndex + 1, text, x: Number(matrix[5]), y: Number(matrix[6]) });
      }
    }
  });
  return { pdf, positions };
}

function savePaginationEvidence(name: string, bytes: Uint8Array, positions: TextPosition[]) {
  const phase = process.env.CLEARSKIN_PDF_QA_PHASE;
  if (phase !== "before" && phase !== "after") return;
  const directory = path.resolve("test-results", "pdf-pagination");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}-${phase}.pdf`), bytes);
  fs.writeFileSync(path.join(directory, `${name}-${phase}-positions.json`), JSON.stringify(positions, null, 2));
}

const syntheticHeader = [
  "Name: SYNTHETIC Pagination Check",
  "Sex: Female    DOB: 01/01/1970    MRN: TEST-ONLY    Date: 09/18/2026",
  ""
];

describe("visit PDF generation", () => {
  it("embeds PNG image bytes even when the file name says jpg", async () => {
    const pngBytes = dataUrlBytes(pngDataUrl);
    const pdfBytes = await buildVisitPdf({
      noteText: [
        "Name: Ava Derm",
        "Sex: Female    DOB: 05/22/1974    MRN: MRN-1001    Date: 05/08/2026",
        "",
        "HPI:",
        "Patient was treated today."
      ].join("\n"),
      logoInput: {
        bytes: pngBytes,
        fileName: "office-logo.jpg",
        mimeType: "image/jpeg"
      },
      photoInputs: [
        {
          caption: "Treatment Photo",
          image: {
            bytes: pngBytes,
            fileName: "photo.jpg",
            mimeType: "image/jpeg"
          }
        }
      ],
      attachmentInputs: []
    });

    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("formats page numbers for all generated visit PDF pages", async () => {
    const attachmentDoc = await PDFDocument.create();
    attachmentDoc.addPage([612, 792]);
    const attachmentBytes = await attachmentDoc.save();
    const pdfBytes = await buildVisitPdf({
      noteText: [
        "Name: Ava Derm",
        "Sex: Female    DOB: 05/22/1974    MRN: MRN-1001    Date: 05/08/2026",
        "",
        "HPI:",
        "Patient was treated today."
      ].join("\n"),
      logoInput: null,
      photoInputs: [],
      attachmentInputs: [
        {
          caption: "Outside PDF Attachment",
          file: {
            bytes: attachmentBytes,
            fileName: "outside.pdf",
            mimeType: "application/pdf"
          }
        }
      ]
    });

    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(formatVisitPdfPageNumber(0, pdf.getPageCount())).toBe("Page 1 of 2");
    expect(formatVisitPdfPageNumber(1, pdf.getPageCount())).toBe("Page 2 of 2");
  });

  it("keeps every wrapped ultrasound and additional-notes line above the footer across pages", async () => {
    const paragraph = (prefix: string) => Array.from({ length: 80 }, (_, index) =>
      `${prefix}_${String(index).padStart(3, "0")} Synthetic treated-site observation retained for this follow-up assessment.`
    ).join(" ");
    const pdfBytes = await buildVisitPdf({
      noteText: [...syntheticHeader,
        "Chief Complaint:", "Synthetic post-treatment follow-up.",
        ...Array.from({ length: 32 }, (_, index) => `Prior observation ${index + 1}: synthetic context.`),
        `Ultrasound Performed: ${paragraph("ULTRASOUND")}`,
        `Additional Notes: ${paragraph("ADDITIONAL")}`,
        "Follow Up: Return for the documented follow-up.",
        "Supervised by:", "", "________________________________________", "Physician Signature",
        "Synthetic Physician", "______________________", "Date"
      ].join("\n"), photoInputs: [], attachmentInputs: []
    });
    const { pdf, positions } = await readTextPositions(pdfBytes);
    savePaginationEvidence("follow-up-long-notes", pdfBytes, positions);
    const body = positions.filter(({ text }) => /ULTRASOUND_|ADDITIONAL_/.test(text));
    const text = body.map((entry) => entry.text).join(" ");
    for (const prefix of ["ULTRASOUND", "ADDITIONAL"]) {
      for (let index = 0; index < 80; index += 1) expect(text).toContain(`${prefix}_${String(index).padStart(3, "0")}`);
    }
    expect(body.filter(({ y }) => y < 40 || y > 650)).toEqual([]);
    expect(new Set(body.map(({ page }) => page)).size).toBeGreaterThan(2);
    expect(positions.some(({ text }) => text === "Physician Signature")).toBe(true);
    expect(positions.filter(({ text }) => text === "SYNTHETIC Pagination Check")).toHaveLength(pdf.getPageCount());
    expect(positions.filter(({ text }) => /^Page \d+ of \d+$/.test(text))).toHaveLength(pdf.getPageCount());
  });

  it("paginates a long bold Plan paragraph without drawing any line below the body margin", async () => {
    const plan = Array.from({ length: 90 }, (_, index) =>
      `PLAN_${String(index).padStart(3, "0")} Synthetic counseling detail with follow-up instructions.`
    ).join(" ");
    const pdfBytes = await buildVisitPdf({
      noteText: [...syntheticHeader, ...Array.from({ length: 40 }, () => "Synthetic context before the plan."), `Plan: ${plan}`].join("\n"),
      photoInputs: [], attachmentInputs: []
    });
    const { positions } = await readTextPositions(pdfBytes);
    savePaginationEvidence("long-bold-plan", pdfBytes, positions);
    const planPositions = positions.filter(({ text }) => text.includes("PLAN_"));
    expect(planPositions.filter(({ y }) => y < 40 || y > 650)).toEqual([]);
    expect(new Set(planPositions.map(({ page }) => page)).size).toBeGreaterThan(1);
    expect(planPositions.map(({ text }) => text).join(" ")).toContain("PLAN_089");
  });

  it("moves the complete diagnosis heading away from the footer", async () => {
    const pdfBytes = await buildVisitPdf({
      noteText: [...syntheticHeader, ...Array.from({ length: 47 }, () => "Synthetic examination detail."),
        "1. First synthetic diagnosis (C44.91)", "2. Second synthetic diagnosis (C44.92)"
      ].join("\n"), photoInputs: [], attachmentInputs: []
    });
    const { positions } = await readTextPositions(pdfBytes);
    savePaginationEvidence("diagnosis-near-footer", pdfBytes, positions);
    const diagnosis = positions.filter(({ text }) => text.includes("Second synthetic diagnosis") || text === "2." || text === "(C44.92)");
    expect(diagnosis).toHaveLength(3);
    expect(new Set(diagnosis.map(({ page }) => page)).size).toBe(1);
    expect(diagnosis.every(({ page, y }) => page === 2 && y >= 40)).toBe(true);
  });
});
