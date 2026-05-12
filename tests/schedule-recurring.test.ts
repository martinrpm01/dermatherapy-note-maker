import { describe, expect, it } from "vitest";

import { CUTOUT_SIZE_OPTIONS } from "../src/renderer/src/modal-components";
import {
  buildLinkedForm,
  getPrintableScheduleAppointments,
  getTreatmentAppointmentCount,
  shouldUseRecurringFractionInput,
  type AppointmentFormState
} from "../src/renderer/src/schedule-screen";
import type { DashboardCourseRow, ScheduleAppointmentRecord } from "../src/shared/types";

function makeCourse(overrides: Partial<DashboardCourseRow> = {}): DashboardCourseRow {
  return {
    patientId: "patient_1",
    patientName: "June, Patient",
    patientMrn: "MRN-1",
    patientDob: "1970-01-01",
    patientFacePhoto: null,
    courseId: "course_1",
    courseName: "June Course",
    courseType: "one_site",
    prescribedFractions: 0,
    currentFraction: 0,
    suggestedTreatmentNumber: 1,
    suggestedNoteType: "standard_treatment",
    nextTemplateKey: "one_site:standard_treatment",
    siteSummary: "Nose",
    latestDraftVisitId: null,
    latestDraftUpdatedAt: null,
    ...overrides
  };
}

function makeAppointment(overrides: Partial<ScheduleAppointmentRecord> = {}): ScheduleAppointmentRecord {
  return {
    id: "appointment_1",
    patientId: "patient_1",
    courseId: "course_1",
    patientName: "June, Patient",
    patientFirstName: "Patient",
    patientLastName: "June",
    patientMrn: "MRN-1",
    patientDob: "1970-01-01",
    patientSex: "",
    appointmentDate: "2026-06-01",
    startTime: "09:00",
    endTime: "09:30",
    appointmentType: "treatment",
    appointmentNumber: 1,
    totalAppointments: 10,
    status: "scheduled",
    notes: "",
    seriesId: "series_1",
    intakeCourseType: null,
    intakeBiopsyDate: "",
    intakeSites: [],
    createdAt: "2026-05-12T12:00:00.000Z",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides
  };
}

describe("schedule recurring treatment defaults", () => {
  it("includes 40mm as a cutout option between 37mm and 45mm", () => {
    expect(CUTOUT_SIZE_OPTIONS).toContain("40mm");
    expect(CUTOUT_SIZE_OPTIONS.indexOf("40mm")).toBeGreaterThan(CUTOUT_SIZE_OPTIONS.indexOf("37mm"));
    expect(CUTOUT_SIZE_OPTIONS.indexOf("40mm")).toBeLessThan(CUTOUT_SIZE_OPTIONS.indexOf("45mm"));
  });

  it("requires an explicit recurring fraction count when a linked course has no prescription total", () => {
    const course = makeCourse({ prescribedFractions: 0 });
    const form = buildLinkedForm(course, "2026-06-01", "09:00", true);

    expect(form.recurring).toBe(true);
    expect(form.recurringCount).toBe("");
    expect(shouldUseRecurringFractionInput(course)).toBe(true);
    expect(getTreatmentAppointmentCount(form, course)).toBe(0);
    expect(getTreatmentAppointmentCount({ ...form, recurringCount: "10" }, course)).toBe(10);
  });

  it("uses the remaining course prescription when a linked course has prescribed fractions", () => {
    const course = makeCourse({ prescribedFractions: 10, suggestedTreatmentNumber: 3 });
    const form = buildLinkedForm(course, "2026-06-01", "09:00", true);

    expect(form.recurring).toBe(true);
    expect(form.recurringCount).toBe("8");
    expect(shouldUseRecurringFractionInput(course)).toBe(false);
    expect(getTreatmentAppointmentCount(form, course)).toBe(8);
  });

  it("keeps manual recurring appointments driven by the selected recurring count", () => {
    const form: AppointmentFormState = {
      ...buildLinkedForm(makeCourse(), "2026-06-01", "09:00", true),
      source: "manual",
      courseId: "",
      patientId: null,
      recurringCount: "12"
    };

    expect(shouldUseRecurringFractionInput(null)).toBe(true);
    expect(getTreatmentAppointmentCount(form, null)).toBe(12);
  });

  it("prints the clicked course schedule without cancelled or non-treatment appointments", () => {
    const clickedAppointment = makeAppointment({ id: "clicked", courseId: "course_1" });
    const printableAppointments = getPrintableScheduleAppointments(clickedAppointment, [
      makeAppointment({ id: "later", appointmentDate: "2026-06-03", startTime: "10:00", appointmentNumber: 2 }),
      makeAppointment({ id: "cancelled", appointmentDate: "2026-06-05", status: "cancelled", appointmentNumber: 3 }),
      makeAppointment({ id: "consult", appointmentType: "sim_consult", appointmentNumber: 0, totalAppointments: null }),
      makeAppointment({ id: "other-course", courseId: "course_2", patientId: "patient_1", appointmentNumber: 1 }),
      clickedAppointment
    ]);

    expect(printableAppointments.map((appointment) => appointment.id)).toEqual(["clicked", "later"]);
  });
});
