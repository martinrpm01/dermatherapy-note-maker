import type { StructuredDataStore } from "./storage";
import type { CourseInput, PatientRecord, TreatmentCourseRecord, VisitInput, VisitNoteRecord } from "./types";
import { isTreatmentNoteType } from "./note-rules";

type CourseContextStore = Pick<StructuredDataStore, "fetchPatient" | "fetchCourse" | "fetchVisit" | "fetchSites" | "fetchVisitsByCourseIds">;

function sameVisitSlot(left: Pick<VisitInput, "noteType" | "treatmentNumber" | "visitDate">, right: Pick<VisitInput, "noteType" | "treatmentNumber" | "visitDate">) {
  if (isTreatmentNoteType(left.noteType) && isTreatmentNoteType(right.noteType)) {
    return left.treatmentNumber === right.treatmentNumber;
  }
  if (left.noteType !== right.noteType) return false;
  return left.noteType === "follow_up" ? left.visitDate === right.visitDate : true;
}

export function prepareIsolatedCourseInput(store: CourseContextStore, input: CourseInput): CourseInput {
  if (!store.fetchPatient(input.patientId)) {
    throw new Error("Patient not found.");
  }
  const existing = input.id ? store.fetchCourse(input.id) : null;
  if (input.id && !existing) {
    throw new Error("Course not found. Start a new course instead of saving a missing course.");
  }
  if (existing && existing.patientId !== input.patientId) {
    throw new Error("This course belongs to a different patient. Reopen the correct course.");
  }

  const ownedSiteIds = new Set(existing ? store.fetchSites([existing.id]).map((site) => site.id) : []);
  const usedIds = new Set<string>();
  return {
    ...input,
    sites: input.sites.map((site) => {
      if (site.id && ownedSiteIds.has(site.id) && !usedIds.has(site.id)) {
        usedIds.add(site.id);
        return site;
      }
      const { id, ...freshSite } = site;
      return freshSite;
    })
  };
}

export function requireVisitInCourse(store: CourseContextStore, visitId: string, courseId: string) {
  const visit = store.fetchVisit(visitId);
  if (!visit) {
    throw new Error("Visit not found. Reopen the course before continuing.");
  }
  const course = store.fetchCourse(courseId);
  if (!course || visit.courseId !== courseId || visit.patientId !== course.patientId) {
    throw new Error("This note belongs to a different course. Reopen the correct course before continuing.");
  }
  return visit;
}

export function requireVisitSaveContext(store: CourseContextStore, input: VisitInput) {
  const patient = store.fetchPatient(input.patientId);
  const course = store.fetchCourse(input.courseId);
  if (!patient || !course) {
    throw new Error("Visit context is incomplete.");
  }
  if (course.patientId !== patient.id) {
    throw new Error("This course belongs to a different patient. Reopen the correct course.");
  }
  if (input.id) {
    const existing = requireVisitInCourse(store, input.id, course.id);
    if (!sameVisitSlot(existing, input) && store.fetchVisitsByCourseIds([course.id]).some(
      ({ note }) => note.id !== existing.id && sameVisitSlot(note, input)
    )) {
      throw new Error("A note already exists for that visit in this course. Open that note instead of changing this note's visit type or treatment number.");
    }
  }
  return { patient, course };
}

function filenamePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function buildCourseVisitPdfBaseName(
  patient: Pick<PatientRecord, "id" | "firstName" | "lastName">,
  course: Pick<TreatmentCourseRecord, "id" | "courseName">,
  visit: Pick<VisitNoteRecord, "id" | "noteType" | "treatmentNumber" | "visitDate">,
  maxLength = 96
) {
  const patientName = filenamePart(`${patient.firstName} ${patient.lastName}`) || filenamePart(patient.id);
  const treatmentLabel = visit.noteType === "follow_up"
    ? `follow-up-${visit.visitDate}`
    : visit.treatmentNumber === null ? "consult" : `tx${visit.treatmentNumber}`;
  const courseName = filenamePart(course.courseName) || "course";
  // Full course/visit ids scope stored paths; a short course reference distinguishes downloads with matching labels.
  const courseReference = filenamePart(course.id).slice(-8);
  const fixedLength = `-${treatmentLabel}-note--${courseReference}`.length;
  const labelBudget = Math.max(2, maxLength - fixedLength);
  const patientBudget = Math.min(patientName.length, 48, Math.max(1, Math.floor(labelBudget / 2)));
  const courseBudget = Math.min(36, Math.max(1, labelBudget - patientBudget));
  return `${patientName.slice(0, patientBudget)}-${treatmentLabel}-note-${courseName.slice(0, courseBudget)}-${courseReference}`;
}
