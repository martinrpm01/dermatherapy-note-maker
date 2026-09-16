import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { RadiationNoteRepository } from "../src/main/repository";
import { RadiationNoteService } from "../src/main/backend";
import { DesktopBinaryAssetStore } from "../src/main/storage/desktop-binary-asset-store";
import { createEmptyCourseForm } from "../src/renderer/src/helpers";
import { BrowserAppClient } from "../src/renderer/src/runtime/browser-app-client";
import { BrowserStructuredDataStore } from "../src/renderer/src/storage/browser-structured-data-store";
import { DEFAULT_TEMPLATE_DEFINITIONS } from "../src/shared/templates";
import type { CourseInput } from "../src/shared/types";

const photo = { name: "old-treatment.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sQ1ko4AAAAASUVORK5CYII=" };

function courseInput(patientId: string, courseName: string, bodyLocation: string): CourseInput {
  const empty = createEmptyCourseForm(patientId);
  return { ...empty, courseName, startDate: "2026-09-16", sites: [{ ...empty.sites[0], bodyLocation, treatmentLocationText: bodyLocation }] };
}

let tempDir = "";
let service: RadiationNoteService;
let repository: RadiationNoteRepository;
let assets: DesktopBinaryAssetStore;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-isolation-"));
  assets = new DesktopBinaryAssetStore(path.join(tempDir, "storage"));
  repository = new RadiationNoteRepository(tempDir, assets);
  service = new RadiationNoteService(repository, assets);
  await service.initialize();
});

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function createConcurrentCourses() {
  const patient = service.savePatient({ firstName: "Test", lastName: "Isolation", mrn: "SYNTHETIC", dob: "1970-01-01", notes: "" });
  const firstInput = courseInput(patient.id, "Current course", "Left cheek");
  const first = service.saveCourse({ ...firstInput, prescribedFractions: 10, sites: [{ ...firstInput.sites[0], dailyDose: 500, totalDose: 5000 }] });
  const next = service.saveCourse(courseInput(patient.id, "Next course", "Right temple"));
  return { patient, first, next };
}

describe("concurrent course isolation", () => {
  it("opens a clean new consult and preserves active-course notes, photos, documents and PDFs byte for byte", async () => {
    const { patient, first, next } = createConcurrentCourses();
    const oldConsult = service.buildVisitDraft(first.id, "consult_sim");
    oldConsult.note.editedText = "OLD CONSULT CONTENT";
    oldConsult.note.status = "finalized";
    oldConsult.note.vitals.weight = "199";
    oldConsult.note.newPhotoUploads = [photo];
    const oldConsultNote = service.saveVisit(oldConsult.note);
    const oldPdf = await service.generatePdf(oldConsultNote.id);
    const oldPdfPath = assets.resolveAssetPath(oldPdf.pdfAsset)!;
    const oldPdfBytes = fs.readFileSync(oldPdfPath);

    const oldTreatment = service.buildVisitDraft(first.id, "next_treatment");
    oldTreatment.note.editedText = "OLD TREATMENT CONTENT";
    oldTreatment.note.newPhotoUploads = [photo];
    const oldTreatmentNote = service.saveVisit(oldTreatment.note);
    const oldPhoto = repository.fetchVisitPhotos(oldTreatmentNote.id)[0];
    const oldPhotoPath = assets.resolveAssetPath(oldPhoto.imageAsset)!;
    const oldPhotoBytes = fs.readFileSync(oldPhotoPath);
    const documentPath = path.join(assets.getCourseDocumentsDir(patient.id, first.id), "old-questionnaire.pdf");
    assets.writeBinaryFile(documentPath, new Uint8Array([1, 2, 3]));
    repository.upsertCourseDocument(first.id, "consult_questionnaire", documentPath, "old questionnaire", "application/pdf", "old-questionnaire.pdf", { ...oldConsult.note.vitals, weight: "199" });
    const oldCourseState = service.getPatientDetail(patient.id).courses.find((detail) => detail.course.id === first.id)!;

    const newConsult = service.buildVisitDraft(next.id, "next_treatment");
    expect(newConsult.note).toMatchObject({ courseId: next.id, noteType: "consult_sim", treatmentNumber: null, status: "draft", newPhotoUploads: [], newAttachmentUploads: [] });
    expect(newConsult.note.id).toBeUndefined();
    expect(newConsult.existingPhotos).toEqual([]);
    expect(newConsult.existingAttachments).toEqual([]);
    expect(newConsult.generatedPdfs).toEqual([]);
    expect(newConsult.courseDocuments).toEqual([]);
    expect(newConsult.note.vitals.weight).toBe("");
    expect(newConsult.note.structuredFields.siteSnapshots[0]).toMatchObject({ bodyLocation: "Right temple", dailyDose: 0, cumulativeDose: 0 });
    expect(newConsult.note.editedText).not.toMatch(/OLD|Left cheek/);
    newConsult.note.editedText = "NEW CONSULT CONTENT";
    newConsult.note.status = "finalized";
    const newNote = service.saveVisit(newConsult.note);
    const newPdf = await service.generatePdf(newNote.id);
    const newPdfPath = assets.resolveAssetPath(newPdf.pdfAsset)!;
    expect(newPdfPath).not.toBe(oldPdfPath);
    expect(path.basename(newPdfPath)).toContain("next-course");
    expect((await PDFDocument.load(fs.readFileSync(newPdfPath))).getPageCount()).toBe(1);
    expect(fs.readFileSync(oldPdfPath)).toEqual(oldPdfBytes);
    expect(fs.readFileSync(oldPhotoPath)).toEqual(oldPhotoBytes);
    expect(service.getPatientDetail(patient.id).courses.find((detail) => detail.course.id === first.id)).toEqual(oldCourseState);
    expect(repository.fetchCourse(first.id)?.status).toBe("active");

    const reopened = service.buildVisitDraft(next.id, "consult_sim");
    expect(reopened.note.id).toBe(newNote.id);
    expect(reopened.note.editedText).toBe("NEW CONSULT CONTENT");
    expect(reopened.existingPhotos).toEqual([]);
    reopened.note.editedText = "UPDATED NEW CONSULT";
    const savedAgain = service.saveVisit(reopened.note);
    expect(savedAgain.id).toBe(newNote.id);
    await service.generatePdf(savedAgain.id);
    expect(fs.readFileSync(oldPdfPath)).toEqual(oldPdfBytes);
    service.deleteCourse(next.id);
    expect(fs.readFileSync(oldPdfPath)).toEqual(oldPdfBytes);
    expect(fs.readFileSync(oldPhotoPath)).toEqual(oldPhotoBytes);
  });

  it("rejects wrong-course and missing note IDs before changing any course or note", () => {
    const { patient, first, next } = createConcurrentCourses();
    const firstNote = service.saveVisit(service.buildVisitDraft(first.id, "next_treatment").note);
    const newDraft = service.buildVisitDraft(next.id, "consult_sim");
    const before = service.getPatientDetail(patient.id);
    expect(() => service.buildVisitDraft(next.id, "consult_sim", firstNote.id)).toThrow(/different course/);
    expect(() => service.buildVisitDraft(next.id, "consult_sim", "missing")).toThrow(/Visit not found/);
    expect(() => service.saveVisit({ ...newDraft.note, id: firstNote.id })).toThrow(/different course/);
    expect(() => service.saveVisit({ ...newDraft.note, id: "missing" })).toThrow(/Visit not found/);
    const otherPatient = service.savePatient({ firstName: "Other", lastName: "Patient", mrn: "SYNTHETIC2", dob: "1970-01-01", notes: "" });
    expect(() => service.saveVisit({ ...newDraft.note, patientId: otherPatient.id })).toThrow(/different patient/);
    expect(service.getPatientDetail(patient.id)).toEqual(before);
    expect(service.buildVisitDraft(first.id, "next_treatment", firstNote.id).note.id).toBe(firstNote.id);
  });

  it("always allocates fresh site IDs for a new course while preserving existing-course IDs on edits", () => {
    const { patient, first } = createConcurrentCourses();
    const oldSite = repository.fetchSites([first.id])[0];
    const copied = service.saveCourse({ ...courseInput(patient.id, "Another", "Forehead"), sites: [{ ...oldSite, bodyLocation: "Forehead" }] });
    expect(repository.fetchSites([copied.id])[0].id).not.toBe(oldSite.id);
    expect(repository.fetchSites([first.id])[0]).toEqual(oldSite);
    const copiedSite = repository.fetchSites([copied.id])[0];
    service.saveCourse({ ...courseInput(patient.id, "Renamed", "Forehead"), id: copied.id, sites: [copiedSite] });
    expect(repository.fetchSites([copied.id])[0].id).toBe(copiedSite.id);
    expect(() => service.saveCourse({ ...courseInput(patient.id, "Missing", "Forehead"), id: "missing" })).toThrow(/Course not found/);
  });

  it("retains a legacy shared PDF while another historical visit still references it", async () => {
    const { first, next } = createConcurrentCourses();
    const firstNote = service.saveVisit(service.buildVisitDraft(first.id, "consult_sim").note);
    const nextNote = service.saveVisit(service.buildVisitDraft(next.id, "consult_sim").note);
    const legacyPath = path.join(tempDir, "All Patient Notes", "Consult Notes", "Isolation, Test", "legacy-consult.pdf");
    const legacyBytes = new Uint8Array([4, 5, 6, 7]);
    assets.writeBinaryFile(legacyPath, legacyBytes);
    repository.insertGeneratedPdf(firstNote.id, legacyPath, 1);
    repository.insertGeneratedPdf(nextNote.id, legacyPath, 1);
    await service.generatePdf(nextNote.id);
    expect(fs.readFileSync(legacyPath)).toEqual(Buffer.from(legacyBytes));
    service.deleteCourse(next.id);
    expect(fs.readFileSync(legacyPath)).toEqual(Buffer.from(legacyBytes));
    await service.generatePdf(firstNote.id);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("bounds long display labels in Windows PDF paths while retaining full course and visit ownership", async () => {
    const patient = service.savePatient({ firstName: "LongGivenName".repeat(8), lastName: "LongFamilyName".repeat(8), mrn: "LONG-SYNTHETIC", dob: "1970-01-01", notes: "" });
    const course = service.saveCourse(courseInput(patient.id, "Long Course Name ".repeat(12), "Forehead"));
    const note = service.saveVisit(service.buildVisitDraft(course.id, "follow_up").note);
    const pdf = await service.generatePdf(note.id);
    const pdfPath = assets.resolveAssetPath(pdf.pdfAsset)!;
    expect(pdfPath.length).toBeLessThan(260);
    expect(pdfPath).toContain(path.join(course.id, note.id));
    expect(fs.existsSync(pdfPath)).toBe(true);
  });

  it("restores separate course PDFs to separate paths", async () => {
    const { patient, first, next } = createConcurrentCourses();
    const bytesByCourse = new Map<string, Buffer>();
    for (const course of [first, next]) {
      const draft = service.buildVisitDraft(course.id, "consult_sim");
      draft.note.editedText = course.courseName;
      const note = service.saveVisit(draft.note);
      const pdf = await service.generatePdf(note.id);
      bytesByCourse.set(course.id, fs.readFileSync(assets.resolveAssetPath(pdf.pdfAsset)!));
      service.completeCourse(course.id);
    }
    const exported = await service.exportPatientArchive(patient.id);
    const restoreDir = path.join(tempDir, "restored");
    const restoredAssets = new DesktopBinaryAssetStore(path.join(restoreDir, "storage"));
    const restoredRepo = new RadiationNoteRepository(restoreDir, restoredAssets);
    const restoredService = new RadiationNoteService(restoredRepo, restoredAssets);
    await restoredService.initialize();
    const result = await restoredService.restorePatientArchive(exported.archiveHandle);
    expect(result.status).toBe("restored");
    const restored = restoredService.getPatientDetail(patient.id);
    const paths = restored.courses.map(({ course, visits }) => {
      const pdfPath = restoredAssets.resolveAssetPath(visits[0].pdfs[0].fileAsset)!;
      expect(fs.readFileSync(pdfPath)).toEqual(bytesByCourse.get(course.id));
      return pdfPath;
    });
    expect(new Set(paths).size).toBe(2);
  });
});

describe("browser course isolation", () => {
  it("uses fresh course sites and rejects stale note contexts with browser store semantics", async () => {
    // Exercise real browser map and client logic; only IndexedDB writes are replaced for this Node test.
    const store = new BrowserStructuredDataStore();
    Reflect.set(store, "initialized", true);
    Reflect.set(store, "db", {});
    Reflect.set(store, "queuePut", () => {});
    Reflect.set(store, "queueDelete", () => {});
    Reflect.set(store, "templates", new Map(DEFAULT_TEMPLATE_DEFINITIONS.map((template) => [template.id, template])));
    const client = new BrowserAppClient();
    Reflect.set(client, "structuredDataStore", store);
    Reflect.set(client, "getBinaryAssetStore", async () => ({ flush: async () => {} }));
    const patient = store.savePatient({ firstName: "Browser", lastName: "Synthetic", mrn: "BROWSER-TEST", dob: "1970-01-01", notes: "" }, null);
    const old = await client.saveCourse(courseInput(patient.id, "Old course", "Left cheek"));
    const oldSite = store.fetchSites([old.id])[0];
    const oldNote = await client.saveVisit((await client.buildVisitDraft(old.id, "consult_sim")).note);
    store.addVisitPhoto(oldNote.id, "browser-asset://old-photo/old.png", 1, "OLD PHOTO");
    const next = await client.saveCourse({ ...courseInput(patient.id, "Next course", "Right temple"), sites: [{ ...oldSite, bodyLocation: "Right temple", treatmentLocationText: "Right temple" }] });
    expect(store.fetchSites([old.id])[0]).toEqual(oldSite);
    expect(store.fetchSites([next.id])[0].id).not.toBe(oldSite.id);
    const draft = await client.buildVisitDraft(next.id, "consult_sim");
    expect(draft.existingPhotos).toEqual([]);
    expect(draft.courseDocuments).toEqual([]);
    expect(draft.note.id).toBeUndefined();
    const oldState = structuredClone(store.fetchVisit(oldNote.id));
    await expect(client.buildVisitDraft(next.id, "consult_sim", oldNote.id)).rejects.toThrow(/different course/);
    await expect(client.saveVisit({ ...draft.note, id: oldNote.id })).rejects.toThrow(/different course/);
    await expect(client.saveVisit({ ...draft.note, id: "missing" })).rejects.toThrow(/Visit not found/);
    expect(store.fetchVisit(oldNote.id)).toEqual(oldState);
    expect(store.fetchVisitPhotos(oldNote.id)).toHaveLength(1);
    const saved = await client.saveVisit(draft.note);
    expect((await client.buildVisitDraft(next.id, "consult_sim")).note.id).toBe(saved.id);
    expect(store.fetchVisitPhotos(saved.id)).toEqual([]);
  });
});
