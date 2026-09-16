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
import { createDefaultConsultQuestionnaireInput } from "../src/shared/consult-questionnaire-pdf";
import { createEmptyVitals } from "../src/shared/note-rules";
import { DEFAULT_TEMPLATE_DEFINITIONS } from "../src/shared/templates";
import type { TreatmentCourseRecord, VisitNoteRecord } from "../src/shared/types";

type Runtime = "desktop" | "browser";
type Client = RadiationNoteService | BrowserAppClient;
type Store = RadiationNoteRepository | BrowserStructuredDataStore;

async function extractGeneratedPdfText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const decoded = Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
    for (const match of decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      text.push(Buffer.from(match[1], "hex").toString("latin1"));
    }
  }
  return text.join("\n");
}

describe.each<Runtime>(["desktop", "browser"])("%s OTV vitals isolation", (runtime) => {
  let tempDir = "";
  let client: Client;
  let store: Store;
  let first: TreatmentCourseRecord;
  let next: TreatmentCourseRecord;
  let desktopAssets: DesktopBinaryAssetStore | null;
  let browserAssets: BrowserBinaryAssetStore | null;

  beforeEach(async () => {
    desktopAssets = null;
    browserAssets = null;
    if (runtime === "desktop") {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otv-vitals-"));
      desktopAssets = new DesktopBinaryAssetStore(path.join(tempDir, "storage"));
      const repository = new RadiationNoteRepository(tempDir, desktopAssets);
      const service = new RadiationNoteService(repository, desktopAssets);
      await service.initialize();
      client = service;
      store = repository;
    } else {
      // Use real browser record/blob maps, bypassing only IndexedDB and DOM download I/O.
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
      Reflect.set(browserClient, "readConsultQuestionnaireTemplateBytes", async () => new Uint8Array(fs.readFileSync(path.resolve("assets/templates/radiation-therapy-consult-questionnaire.pdf"))));
      Reflect.set(browserClient, "triggerPdfDownload", () => {});
      client = browserClient;
      store = browserStore;
    }

    const patient = store.savePatient({ firstName: "OTV", lastName: "Synthetic", mrn: "SYNTHETIC-VITALS", dob: "1970-01-01", notes: "" }, null);
    const saveCourse = async (courseName: string, location: string) => {
      const empty = createEmptyCourseForm(patient.id);
      return client.saveCourse({ ...empty, courseName, prescribedFractions: 15, sites: [{ ...empty.sites[0], bodyLocation: location, treatmentLocationText: location }] });
    };
    first = await saveCourse("Current course", "Left cheek");
    next = await saveCourse("Next course", "Right temple");
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

  async function otv(course: TreatmentCourseRecord, treatmentNumber = 5, existingVisitId?: string) {
    const editor = await client.buildVisitDraft(course.id, "next_treatment", existingVisitId, { treatmentNumber });
    expect(editor.note.courseId).toBe(course.id);
    expect(editor.note.noteType).toBe("otv");
    return editor;
  }

  async function pdfText(note: VisitNoteRecord) {
    const result = await client.generatePdf(note.id);
    const bytes = desktopAssets
      ? fs.readFileSync(desktopAssets.resolveAssetPath(result.pdfAsset)!)
      : new Uint8Array(await browserAssets!.getStoredBlob(result.pdfAsset.assetId)!.arrayBuffer());
    return extractGeneratedPdfText(bytes);
  }

  it("copies questionnaire BP, heart rate and oxygen only into its own consult, never into either course's OTVs", async () => {
    const oldOtv = await otv(first);
    oldOtv.note.vitals = { ...createEmptyVitals(), bloodPressure: "119/79", heartRate: "63", oxygenSaturation: "99" };
    const savedOld = await client.saveVisit(oldOtv.note);
    const oldSnapshot = structuredClone(store.fetchVisit(savedOld.id));

    const questionnaire = createDefaultConsultQuestionnaireInput();
    questionnaire.vitals = { ...questionnaire.vitals, bloodPressure: "161/91", heartRate: "87", oxygenSaturation: "94" };
    await client.generateCourseConsultQuestionnaire(next.id, questionnaire);
    expect(store.fetchVisit(savedOld.id)).toEqual(oldSnapshot);

    const nextConsult = await client.buildVisitDraft(next.id, "consult_sim");
    expect(nextConsult.note.vitals).toMatchObject({ bloodPressure: "161/91", heartRate: "87", oxygenSaturation: "94" });
    await client.saveVisit(nextConsult.note);
    expect((await client.buildVisitDraft(first.id, "consult_sim")).note.vitals).toEqual(createEmptyVitals());
    expect((await otv(first, 5, savedOld.id)).note.vitals).toMatchObject({ bloodPressure: "119/79 mmHg", heartRate: "63 BPM", oxygenSaturation: "99%" });
    expect((await otv(first, 10)).note.vitals).toEqual(createEmptyVitals());

    const nextOtv = await otv(next);
    expect(nextOtv.note.vitals).toEqual(createEmptyVitals());
    const savedNext = await client.saveVisit(nextOtv.note);
    expect((await otv(next, 5, savedNext.id)).note.vitals).toEqual(createEmptyVitals());
    const blankPdf = await pdfText(savedNext);
    expect(blankPdf).not.toMatch(/Exam Vitals:|161\/91|87 BPM|94%/);

    const nextWithVitals = await otv(next, 5, savedNext.id);
    nextWithVitals.note.vitals = { ...createEmptyVitals(), bloodPressure: "127/77", heartRate: "74" };
    await client.saveVisit(nextWithVitals.note);
    expect((await otv(next, 5, savedNext.id)).note.vitals).toMatchObject({ bloodPressure: "127/77 mmHg", heartRate: "74 BPM", oxygenSaturation: "" });
    expect((await otv(next, 10)).note.vitals).toEqual(createEmptyVitals());
    expect(store.fetchVisit(savedOld.id)).toEqual(oldSnapshot);
  });

  it("updates and clears only the structured vital lines in a customized OTV and its regenerated PDF", async () => {
    const draft = await otv(first);
    draft.note.status = "finalized";
    draft.note.editedText = "Clinician-authored OTV narrative.\n\nExam Vitals:\nBlood Pressure: 151/91 mmHg\nHeart Rate: 99 BPM\nOxygen Saturation: 92%\n\nImpression / Plan:\nPreserve this treatment plan.";
    draft.note.vitals = { ...createEmptyVitals(), bloodPressure: "123/77" };
    const saved = await client.saveVisit(draft.note);
    for (const text of [saved.generatedText, saved.editedText, await pdfText(saved)]) {
      expect(text).toContain("Blood Pressure: 123/77 mmHg");
      expect(text).not.toMatch(/151\/91|99 BPM|92%|Heart Rate:|Oxygen Saturation:|Pulse:|Weight:/);
    }
    expect(saved.editedText).toContain("Clinician-authored OTV narrative.");
    expect(saved.editedText).toContain("Preserve this treatment plan.");

    const reopened = await otv(first, 5, saved.id);
    reopened.note.vitals = createEmptyVitals();
    const cleared = await client.saveVisit(reopened.note);
    expect(cleared.id).toBe(saved.id);
    for (const text of [cleared.generatedText, cleared.editedText, await pdfText(cleared)]) {
      expect(text).not.toMatch(/Exam Vitals:|Blood Pressure:|123\/77|Heart Rate:|Oxygen Saturation:|Pulse:|Weight:/);
    }
    expect(cleared.editedText).toContain("Clinician-authored OTV narrative.");
    expect(cleared.editedText).toContain("Preserve this treatment plan.");
    expect((await otv(first, 5, saved.id)).note.vitals).toEqual(createEmptyVitals());
  });

  it("shows entered fields when customized OTV text has no vitals section and omits fields left blank", async () => {
    const draft = await otv(next);
    draft.note.editedText = "Custom OTV assessment.\n\nImpression / Plan:\nKeep this plan unchanged.";
    draft.note.vitals = { bloodPressure: "", heartRate: "72", pulse: "70", oxygenSaturation: "98", weight: "145" };
    const saved = await client.saveVisit(draft.note);
    for (const text of [saved.generatedText, saved.editedText, await pdfText(saved)]) {
      expect(text).toContain("Heart Rate: 72 BPM");
      expect(text).toContain("Pulse: 70 BPM");
      expect(text).toContain("Oxygen Saturation: 98%");
      expect(text).toContain("Weight: 145 lbs");
      expect(text).not.toContain("Blood Pressure:");
    }
    expect(saved.editedText).toContain("Custom OTV assessment.");
    expect(saved.editedText).toContain("Keep this plan unchanged.");
  });

  it("hides stale legacy vitals on reopen and direct PDF regeneration without rewriting stored note text on read", async () => {
    const draft = await otv(first);
    const legacyText = "Name: OTV Synthetic\nDOB: 01/01/1970    MRN: SYNTHETIC-VITALS\n\nHPI:\nLegacy clinician narrative.\n\nExam Vitals:\nBlood Pressure: 151/91 mmHg\nHeart Rate: 99 BPM\nOxygen Saturation: 92%\n\nImpression / Plan:\nRetain the original clinical plan.";
    const legacy = store.saveVisit(
      { ...draft.note, status: "finalized", vitals: createEmptyVitals() },
      draft.note.generatedText,
      legacyText
    );
    const storedBeforeRead = structuredClone(store.fetchVisit(legacy.id));

    const reopened = await otv(first, 5, legacy.id);
    expect(reopened.note.vitals).toEqual(createEmptyVitals());
    expect(reopened.note.editedText).not.toMatch(/Exam Vitals:|Blood Pressure:|151\/91|Heart Rate:|99 BPM|Oxygen Saturation:|92%/);
    expect(reopened.note.editedText).toContain("Legacy clinician narrative.");
    expect(reopened.note.editedText).toContain("Retain the original clinical plan.");
    expect(store.fetchVisit(legacy.id)).toEqual(storedBeforeRead);

    // Regenerate the raw saved record directly, without saving the corrected editor first.
    const regeneratedText = await pdfText(legacy);
    expect(regeneratedText).not.toMatch(/Exam Vitals:|Blood Pressure:|151\/91|Heart Rate:|99 BPM|Oxygen Saturation:|92%/);
    expect(regeneratedText).toContain("Legacy clinician narrative.");
    expect(regeneratedText).toContain("Retain the original clinical plan.");
    expect(store.fetchVisit(legacy.id)).toMatchObject({
      editedText: legacyText,
      generatedText: draft.note.generatedText,
      vitals: createEmptyVitals()
    });
  });

  it("rejects retargeting a saved consult into an occupied OTV slot without changing either note", async () => {
    const consult = await client.buildVisitDraft(first.id, "consult_sim");
    consult.note.vitals = { ...createEmptyVitals(), bloodPressure: "161/91" };
    const savedConsult = await client.saveVisit(consult.note);
    const oldOtv = await otv(first);
    oldOtv.note.vitals = { ...createEmptyVitals(), bloodPressure: "119/79" };
    const savedOtv = await client.saveVisit(oldOtv.note);
    const before = structuredClone(store.fetchVisitsByCourseIds([first.id]));
    const convertConsult = await client.buildVisitDraft(first.id, "consult_sim", savedConsult.id);
    convertConsult.note.noteType = "otv";
    convertConsult.note.treatmentNumber = 5;
    await expect(Promise.resolve().then(() => client.saveVisit(convertConsult.note))).rejects.toThrow();
    expect(store.fetchVisitsByCourseIds([first.id])).toEqual(before);
    expect(store.fetchVisit(savedConsult.id)?.noteType).toBe("consult_sim");
    expect(store.fetchVisit(savedOtv.id)?.vitals.bloodPressure).toBe("119/79 mmHg");
  });
});
