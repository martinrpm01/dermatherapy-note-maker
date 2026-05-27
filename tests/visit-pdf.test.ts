import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildVisitPdf, formatVisitPdfPageNumber } from "../src/main/pdf";

const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sQ1ko4AAAAASUVORK5CYII=";

function dataUrlBytes(dataUrl: string) {
  return Uint8Array.from(Buffer.from(dataUrl.split(",")[1], "base64"));
}

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
});
