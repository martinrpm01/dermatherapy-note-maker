import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RadiationNoteService } from "../src/main/backend";
import { RadiationNoteRepository } from "../src/main/repository";
import { DesktopBinaryAssetStore } from "../src/main/storage/desktop-binary-asset-store";
import { createEmptyCourseForm } from "../src/renderer/src/helpers";
import { BrowserAppClient } from "../src/renderer/src/runtime/browser-app-client";
import { BrowserBinaryAssetStore } from "../src/renderer/src/storage/browser-binary-asset-store";
import { BrowserStructuredDataStore } from "../src/renderer/src/storage/browser-structured-data-store";
import { DEFAULT_TEMPLATE_DEFINITIONS } from "../src/shared/templates";
import type { TreatmentCourseRecord, VisitInput, VisitNoteRecord } from "../src/shared/types";

const ultrasound = "Ultrasound Performed: Follow-up ultrasound findings documented.";
const additional = "First additional follow-up observation.\nSecond additional follow-up observation.";

async function extractPdfText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const parts: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const content = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    for (const match of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      parts.push(Buffer.from(match[1], "hex").toString("latin1"));
    }
  }
  return parts.join("\n");
}

describe.each<"desktop" | "browser">(["desktop", "browser"])("%s follow-up note text", (runtime) => {
  let client: RadiationNoteService | BrowserAppClient;
  let course: TreatmentCourseRecord;
  let desktopAssets: DesktopBinaryAssetStore | null;
  let browserAssets: BrowserBinaryAssetStore | null;
  let tempDir = "";

  beforeEach(async () => {
    desktopAssets = null;
    browserAssets = null;
    let store: RadiationNoteRepository | BrowserStructuredDataStore;
    if (runtime === "desktop") {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "follow-up-text-"));
      desktopAssets = new DesktopBinaryAssetStore(path.join(tempDir, "storage"));
      const repository = new RadiationNoteRepository(tempDir, desktopAssets);
      const service = new RadiationNoteService(repository, desktopAssets);
      await service.initialize();
      client = service;
      store = repository;
    } else {
      // Retain real record/blob behavior and PDF creation; replace only IndexedDB persistence.
      const browserStore = new BrowserStructuredDataStore();
      Reflect.set(browserStore, "initialized", true);
      Reflect.set(browserStore, "db", {});
      Reflect.set(browserStore, "queuePut", () => {});
      Reflect.set(browserStore, "queueDelete", () => {});
      Reflect.set(browserStore, "templates", new Map(DEFAULT_TEMPLATE_DEFINITIONS.map((template) => [template.id, template])));
      browserAssets = new BrowserBinaryAssetStore();
      Reflect.set(browserAssets, "loadPersistedAssets", async () => {});
      Reflect.set(browserAssets, "getDb", async () => ({}));
      Reflect.set(browserAssets, "runTransaction", async () => {});
      const browserClient = new BrowserAppClient();
      Reflect.set(browserClient, "structuredDataStore", browserStore);
      Reflect.set(browserClient, "binaryAssetStore", browserAssets);
      Reflect.set(browserClient, "bytesToDataUrl", async (bytes: Uint8Array, mimeType: string) => `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`);
      client = browserClient;
      store = browserStore;
    }
    const patient = store.savePatient({ firstName: "Followup", lastName: "Synthetic", mrn: "SYNTHETIC-FOLLOWUP", dob: "1970-01-01", notes: "" }, null);
    const empty = createEmptyCourseForm(patient.id);
    course = await client.saveCourse({ ...empty, courseName: "Completed synthetic course", status: "completed", prescribedFractions: 15, sites: [{ ...empty.sites[0], bodyLocation: "Left cheek", treatmentLocationText: "Left cheek" }] });
  });

  afterEach(async () => {
    if (browserAssets) {
      await browserAssets.flush();
      browserAssets.dispose();
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  function addFollowUpDetails(note: VisitInput) {
    note.structuredFields.ultrasoundPerformed = ultrasound;
    note.structuredFields.additionalNotes = additional;
    note.status = "finalized";
  }

  async function printedText(saved: VisitNoteRecord) {
    const result = await client.generatePdf(saved.id);
    const bytes = desktopAssets
      ? fs.readFileSync(desktopAssets.resolveAssetPath(result.pdfAsset)!)
      : new Uint8Array(await browserAssets!.getStoredBlob(result.pdfAsset.assetId)!.arrayBuffer());
    return extractPdfText(bytes);
  }

  async function assertSavedAndPrintedDetails(saved: VisitNoteRecord) {
    expect(saved.structuredFields.ultrasoundPerformed).toBe(ultrasound);
    expect(saved.structuredFields.additionalNotes).toBe(additional);
    for (const text of [saved.generatedText, saved.editedText]) {
      expect(text).toContain(ultrasound);
      expect(text).toContain(additional);
    }
    const printed = await printedText(saved);
    expect(printed).toContain("Follow-up ultrasound findings documented.");
    expect(printed).toContain("First additional follow-up observation.");
    expect(printed).toContain("Second additional follow-up observation.");
    return printed;
  }

  it("refreshes a fresh generated draft after optional follow-up details are entered", async () => {
    const draft = await client.buildVisitDraft(course.id, "follow_up");
    expect(draft.note.editedText).toBe(draft.note.generatedText);
    addFollowUpDetails(draft.note);
    const saved = await client.saveVisit(draft.note);
    await assertSavedAndPrintedDetails(saved);
  });

  it("refreshes an unchanged saved/reopened draft even with whitespace around the generated override", async () => {
    const draft = await client.buildVisitDraft(course.id, "follow_up");
    const original = await client.saveVisit(draft.note);
    const reopened = await client.buildVisitDraft(course.id, "follow_up", original.id);
    reopened.note.editedText = ` \n${reopened.note.generatedText}\n `;
    addFollowUpDetails(reopened.note);
    const saved = await client.saveVisit(reopened.note);
    expect(saved.id).toBe(original.id);
    await assertSavedAndPrintedDetails(saved);
    const savedAgain = await client.buildVisitDraft(course.id, "follow_up", saved.id);
    expect(savedAgain.note.editedText).toContain(ultrasound);
    expect(savedAgain.note.editedText).toContain(additional);
  });

  it("keeps genuine custom wording while retaining saved optional follow-up sections", async () => {
    const draft = await client.buildVisitDraft(course.id, "follow_up");
    addFollowUpDetails(draft.note);
    draft.note.editedText = "";
    const initial = await client.saveVisit(draft.note);
    const reopened = await client.buildVisitDraft(course.id, "follow_up", initial.id);
    reopened.note.editedText = reopened.note.generatedText.replace("Plan: Counseling and Reassurance.", "Plan: Clinician-specific follow-up counseling.");
    expect(reopened.note.editedText).not.toBe(reopened.note.generatedText);
    const saved = await client.saveVisit(reopened.note);
    expect(saved.editedText).toContain("Plan: Clinician-specific follow-up counseling.");
    expect(saved.editedText).not.toContain("Plan: Counseling and Reassurance.");
    const printed = await assertSavedAndPrintedDetails(saved);
    expect(printed).toContain("Clinician-specific follow-up counseling.");
  });

  it("preserves ultrasound and additional prose typed directly into the preview immediately before finalizing", async () => {
    const draft = await client.buildVisitDraft(course.id, "follow_up");
    draft.note.status = "finalized";
    draft.note.editedText = draft.note.generatedText.replace(
      "Follow Up:",
      "Ultrasound Performed: Manually documented follow-up finding.\n\nAdditional Notes: Manually entered observation one.\nManually entered observation two.\n\nFollow Up:"
    );
    expect(draft.note.structuredFields.ultrasoundPerformed).toBe("");
    expect(draft.note.structuredFields.additionalNotes).toBe("");
    const saved = await client.saveVisit(draft.note);
    expect(saved.generatedText).not.toContain("Manually documented follow-up finding.");
    for (const text of [saved.editedText, await printedText(saved)]) {
      expect(text).toContain("Manually documented follow-up finding.");
      expect(text).toContain("Manually entered observation one.");
      expect(text).toContain("Manually entered observation two.");
    }
  });
});
