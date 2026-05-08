import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

import { RadiationNoteRepository } from "../src/main/repository";
import { RadiationNoteService } from "../src/main/backend";
import { DesktopBinaryAssetStore } from "../src/main/storage/desktop-binary-asset-store";
import { formatDisplayDate, getSuggestedNoteType } from "../src/shared/note-rules";
import { buildVisitPreviewText, createCourseFormFromDetail, createEmptyCourseForm } from "../src/renderer/src/helpers";

const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sQ1ko4AAAAASUVORK5CYII=";

let tempDir = "";
let repository: RadiationNoteRepository;
let service: RadiationNoteService;
let assetStore: DesktopBinaryAssetStore;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-note-builder-"));
  assetStore = new DesktopBinaryAssetStore(path.join(tempDir, "storage"));
  repository = new RadiationNoteRepository(tempDir, assetStore);
  service = new RadiationNoteService(repository, assetStore);
  await service.initialize();
});

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

async function createPatientAndCourse() {
  const patient = service.savePatient({
    firstName: "Ava",
    lastName: "Derm",
    mrn: "MRN-1001",
    dob: "1974-05-22",
    notes: "High-priority lesion check."
  });

  const course = service.saveCourse({
    patientId: patient.id,
    courseName: "Nasal Bridge Course",
    courseType: "one_site",
    prescribedFractions: 15,
    startDate: "2026-03-30",
    sites: [
      {
        siteNumber: 1,
        bodyLocation: "Nasal bridge",
        treatmentLocationText: "Bridge of nose",
        diagnosisText: "Basal cell carcinoma",
        icd10: "C44.311",
        numberOfBlocks: 1,
        lesionSize: "10mm",
        treatmentDepth: "3",
        coneSize: "30",
        cutoutSize: "18",
        shields: "Flex shield",
        machine: "Xoft Elekta 1200 SPX",
        energyKv: "50kV",
        treatmentInterval: "bi-weekly",
        additionalDevices: "Custom cutout",
        dailyDose: 500,
        totalDose: 7500
      }
    ]
  });

  return { patient, course };
}

async function createTwoSitePatientAndCourse() {
  const patient = service.savePatient({
    firstName: "Nora",
    lastName: "Dual",
    mrn: "MRN-2002",
    dob: "1968-11-09",
    notes: "Two lesion consult."
  });

  const course = service.saveCourse({
    patientId: patient.id,
    courseName: "Dual Lesion Course",
    courseType: "two_site",
    prescribedFractions: 0,
    startDate: "2026-04-01",
    sites: [
      {
        siteNumber: 1,
        bodyLocation: "Left cheek",
        treatmentLocationText: "Left medial malar cheek",
        diagnosisText: "Basal cell carcinoma",
        icd10: "C44.319",
        numberOfBlocks: 1,
        lesionSize: "8mm",
        treatmentDepth: "3",
        coneSize: "20",
        cutoutSize: "10",
        shields: "",
        machine: "Xoft Elekta 1200 SPX",
        energyKv: "50kV",
        treatmentInterval: "bi-weekly",
        additionalDevices: "",
        dailyDose: 400,
        totalDose: 4000
      },
      {
        siteNumber: 2,
        bodyLocation: "Right ear",
        treatmentLocationText: "Right post auricular skin",
        diagnosisText: "Squamous cell carcinoma",
        icd10: "C44.222",
        numberOfBlocks: 1,
        lesionSize: "10mm",
        treatmentDepth: "3",
        coneSize: "20",
        cutoutSize: "12",
        shields: "",
        machine: "Xoft Elekta 1200 SPX",
        energyKv: "50kV",
        treatmentInterval: "bi-weekly",
        additionalDevices: "",
        dailyDose: 400,
        totalDose: 4000
      }
    ]
  });

  return { patient, course };
}

describe("RadiationNoteService workflow", () => {
  it("generates a desktop recovery code during initial PIN setup and reissues one after recovery reset", async () => {
    const recoveryCode = await service.setInitialPin("1234");
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const initialSettings = repository.getSettingsRecord();
    expect(initialSettings.pinHash).toBeTruthy();
    expect(initialSettings.pinSalt).toBeTruthy();
    expect(initialSettings.recoveryCodeHash).toBeTruthy();
    expect(initialSettings.recoveryCodeSalt).toBeTruthy();

    service.lock();
    expect(await service.unlock("0000")).toBe(false);
    expect(await service.unlock("1234")).toBe(true);

    service.lock();
    const nextRecoveryCode = await service.resetPinWithRecoveryCode(recoveryCode!, "5678");
    expect(nextRecoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(nextRecoveryCode).not.toBe(recoveryCode);

    const updatedSettings = repository.getSettingsRecord();
    expect(updatedSettings.recoveryCodeHash).toBeTruthy();
    expect(updatedSettings.recoveryCodeSalt).toBeTruthy();

    service.lock();
    expect(await service.unlock("1234")).toBe(false);
    expect(await service.unlock("5678")).toBe(true);
  });

  it("wipes desktop local data back to a fresh install state after recovery failure", async () => {
    const recoveryCode = await service.setInitialPin("1234");
    const patient = service.savePatient({
      firstName: "Willa",
      lastName: "Wipe",
      mrn: "MRN-WIPE",
      dob: "1979-09-09",
      notes: "Wipe candidate.",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });
    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Wipe Course",
      courseType: "one_site",
      prescribedFractions: 4,
      startDate: "2026-04-01",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Cheek",
          treatmentLocationText: "Right cheek",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "5mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "10",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "",
          dailyDose: 400,
          totalDose: 1600
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const savedVisit = service.saveVisit(draft.note);
    await service.generatePdf(savedVisit.id);

    await expect(service.resetPinWithRecoveryCode("WRONG-WRNG-CODE", "5678")).rejects.toThrow(
      "Recovery code is incorrect."
    );

    const patientNotesRoot = path.join(tempDir, "All Patient Notes");
    expect(fs.existsSync(repository.dbPath)).toBe(true);
    expect(fs.existsSync(assetStore.rootDir)).toBe(true);
    expect(fs.existsSync(patientNotesRoot)).toBe(true);

    await service.wipeAllLocalData();

    const boot = service.bootstrap();
    expect(boot.requiresPinSetup).toBe(true);
    expect(boot.isLocked).toBe(false);
    expect(repository.fetchPatients("1 = 1", [])).toHaveLength(0);
    expect(repository.fetchCourses("1 = 1", [])).toHaveLength(0);
    expect(repository.getSettingsRecord().pinHash).toBeNull();
    expect(repository.getSettingsRecord().recoveryCodeHash).toBeNull();
    expect(fs.existsSync(repository.dbPath)).toBe(true);
    expect(fs.existsSync(assetStore.rootDir)).toBe(true);
    expect(fs.existsSync(patientNotesRoot)).toBe(false);
    expect(recoveryCode).toBeTruthy();
  });

  it("starts new courses in a sim/consult state with unknown dose values", () => {
    const emptyCourse = createEmptyCourseForm("patient_1");

    expect(emptyCourse.prescribedFractions).toBe(0);
    expect(emptyCourse.sites[0].dailyDose).toBe(0);
    expect(emptyCourse.sites[0].totalDose).toBe(0);
  });

  it("preserves unknown dose values when reopening edit-course data", async () => {
    const { patient, course } = await createPatientAndCourse();

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: 15,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: repository.fetchSites([course.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: 0,
        totalDose: 0
      }))
    });

    const detail = service.getPatientDetail(patient.id);
    const form = createCourseFormFromDetail(detail.courses[0]);

    expect(form.prescribedFractions).toBe(15);
    expect(form.sites[0].dailyDose).toBe(0);
    expect(form.sites[0].totalDose).toBe(0);
  });

  it("saves an existing one-lesion course after expanding it to two lesions", async () => {
    const { patient } = await createPatientAndCourse();
    const detail = service.getPatientDetail(patient.id);
    const form = createCourseFormFromDetail(detail.courses[0]);
    const firstSite = form.sites[0];

    const savedCourse = service.saveCourse({
      ...form,
      courseType: "two_site",
      sites: [
        firstSite,
        {
          ...firstSite,
          siteNumber: 2,
          treatmentLocationText: "Right temple",
          bodyLocation: "Right temple",
          icd10: "C44.319"
        }
      ]
    });
    const savedSites = repository.fetchSites([savedCourse.id]);

    expect(savedCourse.courseType).toBe("two_site");
    expect(savedSites).toHaveLength(2);
    expect(new Set(savedSites.map((site) => site.id)).size).toBe(2);
    expect(savedSites.map((site) => site.siteNumber).sort()).toEqual([1, 2]);
  });

  it("uses scheduled sim consult and first treatment dates in the sim consult note", async () => {
    const { patient, course } = await createPatientAndCourse();

    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-10",
      startTime: "09:00",
      endTime: "09:45",
      appointmentType: "sim_consult",
      appointmentNumber: 0,
      totalAppointments: null
    });
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-20",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 2,
      totalAppointments: 15
    });
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-18",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 1,
      totalAppointments: 15
    });

    const syncedCourse = repository.fetchCourse(course.id);
    expect(syncedCourse?.simConsultDate).toBe("2026-05-10");

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    expect(consultDraft.note.visitDate).toBe("2026-05-10");
    expect(consultDraft.note.structuredFields.startRadiationDate).toBe("2026-05-18");
    expect(consultDraft.note.generatedText).toContain(formatDisplayDate("2026-05-18"));
  });

  it("starts today's note as sim consult when a planned consult exists before treatment one", async () => {
    const { patient, course } = await createPatientAndCourse();

    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-10",
      startTime: "09:00",
      endTime: "09:45",
      appointmentType: "sim_consult",
      appointmentNumber: 0,
      totalAppointments: null
    });

    const dashboardCourse = service
      .getDashboardSnapshot()
      .activeCourses.find((row) => row.courseId === course.id);
    expect(dashboardCourse?.suggestedNoteType).toBe("consult_sim");
    expect(dashboardCourse?.suggestedTreatmentNumber).toBeNull();

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.noteType).toBe("consult_sim");
    expect(draft.note.treatmentNumber).toBeNull();
    expect(draft.note.visitDate).toBe("2026-05-10");
  });

  it("makes pending courses schedulable and trims projected treatment appointments when actual fractions are lower", async () => {
    const { patient, course } = await createPatientAndCourse();
    const pendingCourse = service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: 10,
      startDate: course.startDate,
      simConsultDate: course.simConsultDate ?? undefined,
      status: "pending",
      sites: repository.fetchSites([course.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose,
        prescribedFractions: 10
      }))
    });

    const scheduleCourse = service
      .getScheduleSnapshot("2026-01-01", "2026-12-31")
      .activeCourses.find((row) => row.courseId === pendingCourse.id);
    expect(scheduleCourse?.prescribedFractions).toBe(10);
    expect(scheduleCourse?.suggestedTreatmentNumber).toBe(1);

    for (let index = 1; index <= 10; index += 1) {
      service.saveScheduleAppointment({
        patientId: patient.id,
        courseId: pendingCourse.id,
        patientName: "Derm, Ava",
        appointmentDate: `2026-05-${String(index + 10).padStart(2, "0")}`,
        startTime: "09:00",
        endTime: "09:15",
        appointmentType: "treatment",
        appointmentNumber: index,
        totalAppointments: 10
      });
    }
    expect(repository.fetchScheduleAppointments("2026-05-01", "2026-05-31")).toHaveLength(10);

    service.saveCourse({
      id: pendingCourse.id,
      patientId: patient.id,
      courseName: pendingCourse.courseName,
      courseType: pendingCourse.courseType,
      prescribedFractions: 8,
      startDate: pendingCourse.startDate,
      simConsultDate: pendingCourse.simConsultDate ?? undefined,
      status: "active",
      sites: repository.fetchSites([pendingCourse.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose,
        prescribedFractions: 8
      }))
    });

    const remainingAppointments = repository.fetchScheduleAppointments("2026-05-01", "2026-05-31");
    expect(remainingAppointments).toHaveLength(8);
    expect(remainingAppointments.map((appointment) => appointment.appointmentNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("trims and relabels the treatment schedule when treatment one changes prescribed fractions", async () => {
    const { patient, course } = await createPatientAndCourse();

    for (let index = 1; index <= 10; index += 1) {
      service.saveScheduleAppointment({
        patientId: patient.id,
        courseId: course.id,
        patientName: "Derm, Ava",
        appointmentDate: `2026-06-${String(index + 1).padStart(2, "0")}`,
        startTime: "13:00",
        endTime: "13:15",
        appointmentType: "treatment",
        appointmentNumber: index,
        totalAppointments: 10
      });
    }

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.treatmentNumber).toBe(1);

    service.saveVisit({
      ...draft.note,
      structuredFields: {
        ...draft.note.structuredFields,
        prescribedFractionsInput: 8
      }
    });

    expect(repository.fetchCourse(course.id)?.prescribedFractions).toBe(8);
    const remainingAppointments = repository.fetchScheduleAppointments("2026-06-01", "2026-06-30");
    expect(remainingAppointments).toHaveLength(8);
    expect(remainingAppointments.map((appointment) => appointment.appointmentNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(remainingAppointments.map((appointment) => appointment.totalAppointments))).toEqual(new Set([8]));
  });

  it("deletes a course treatment schedule without removing the sim consult appointment", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-04",
      startTime: "09:00",
      endTime: "09:45",
      appointmentType: "sim_consult",
      appointmentNumber: 0,
      totalAppointments: null
    });
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-06",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 1,
      totalAppointments: 2
    });
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-08",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 2,
      totalAppointments: 2
    });

    expect(service.deleteCourseTreatmentSchedule(course.id)).toBe(2);

    const remainingAppointments = repository.fetchScheduleAppointments("2026-05-01", "2026-05-31");
    expect(remainingAppointments).toHaveLength(1);
    expect(remainingAppointments[0].appointmentType).toBe("sim_consult");
  });

  it("removes linked schedule appointments when a patient is archived", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-04",
      startTime: "09:00",
      endTime: "09:45",
      appointmentType: "sim_consult",
      appointmentNumber: 0,
      totalAppointments: null
    });
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-05-06",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 1,
      totalAppointments: 1
    });
    expect(repository.fetchScheduleAppointments("2026-05-01", "2026-05-31")).toHaveLength(2);

    service.archivePatient(patient.id);

    expect(repository.fetchScheduleAppointments("2026-05-01", "2026-05-31")).toHaveLength(0);
  });

  it("completes the matching treatment schedule appointment by treatment number when a note is finalized", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-12-15",
      startTime: "09:00",
      endTime: "09:15",
      appointmentType: "treatment",
      appointmentNumber: 1,
      totalAppointments: 15
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.treatmentNumber).toBe(1);
    expect(draft.note.visitDate).not.toBe("2026-12-15");

    const savedVisit = service.saveVisit({ ...draft.note, status: "finalized" });
    const completedAppointment = service.completeScheduleAppointmentForVisit(savedVisit.id);

    expect(completedAppointment?.status).toBe("completed");
    const scheduleAppointments = repository.fetchScheduleAppointments("2026-12-01", "2026-12-31");
    expect(scheduleAppointments[0].status).toBe("completed");
  });

  it("starts a scheduled treatment draft with the appointment date and treatment number", async () => {
    const { course } = await createPatientAndCourse();

    const draft = service.buildVisitDraft(course.id, "next_treatment", undefined, {
      visitDate: "2026-12-15",
      treatmentNumber: 6
    });

    expect(draft.note.visitDate).toBe("2026-12-15");
    expect(draft.note.treatmentNumber).toBe(6);
    expect(draft.note.noteType).toBe("standard_treatment");
  });

  it("completes the matching sim consult schedule appointment even when the note date differs", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.saveScheduleAppointment({
      patientId: patient.id,
      courseId: course.id,
      patientName: "Derm, Ava",
      appointmentDate: "2026-12-10",
      startTime: "09:00",
      endTime: "09:45",
      appointmentType: "sim_consult",
      appointmentNumber: 0,
      totalAppointments: null
    });

    const draft = service.buildVisitDraft(course.id, "consult_sim");
    expect(draft.note.visitDate).toBe("2026-12-10");

    const savedVisit = service.saveVisit({ ...draft.note, visitDate: "2026-11-30", status: "finalized" });
    const completedAppointment = service.completeScheduleAppointmentForVisit(savedVisit.id);

    expect(completedAppointment?.status).toBe("completed");
    const scheduleAppointments = repository.fetchScheduleAppointments("2026-12-01", "2026-12-31");
    expect(scheduleAppointments[0].status).toBe("completed");
  });

  it("defaults the treatment machine text when a site machine is blank", async () => {
    const { patient, course } = await createPatientAndCourse();

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: repository.fetchSites([course.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: "",
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose
      }))
    });

    const detail = service.getPatientDetail(patient.id);
    const form = createCourseFormFromDetail(detail.courses[0]);
    expect(form.sites[0].machine).toBe("Xoft Elekta 1200 SPX");

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.generatedText).toContain("Machine: Xoft Elekta 1200 SPX");
  });

  it("defaults treatment depth text when a site depth is blank", async () => {
    const { patient, course } = await createPatientAndCourse();

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: repository.fetchSites([course.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: "",
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose
      }))
    });

    const detail = service.getPatientDetail(patient.id);
    const form = createCourseFormFromDetail(detail.courses[0]);
    expect(form.sites[0].treatmentDepth).toBe("3");

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.generatedText).toContain("Treatment Depth: 3mm");
  });

  it("creates a patient and supports multiple courses for the same patient", async () => {
    const { patient } = await createPatientAndCourse();
    service.saveCourse({
      patientId: patient.id,
      courseName: "Forehead Course",
      courseType: "one_site",
      prescribedFractions: 10,
      startDate: "2026-04-12",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Forehead",
          treatmentLocationText: "Central forehead",
          diagnosisText: "Squamous cell carcinoma",
          icd10: "C44.329",
          numberOfBlocks: 1,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "25",
          cutoutSize: "16",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    const detail = service.getPatientDetail(patient.id);
    expect(detail.courses).toHaveLength(2);
  });

  it("updates prescribed fractions on an existing course after visits exist", async () => {
    const { patient, course } = await createPatientAndCourse();
    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(firstDraft.note);

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: 12,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: repository.fetchSites([course.id]).map((site) => ({
        id: site.id,
        siteNumber: site.siteNumber,
        bodyLocation: site.bodyLocation,
        treatmentLocationText: site.treatmentLocationText,
        diagnosisText: site.diagnosisText,
        icd10: site.icd10,
        numberOfBlocks: site.numberOfBlocks,
        lesionSize: site.lesionSize,
        treatmentDepth: site.treatmentDepth,
        coneSize: site.coneSize,
        cutoutSize: site.cutoutSize,
        shields: site.shields,
        machine: site.machine,
        energyKv: site.energyKv,
        treatmentInterval: site.treatmentInterval,
        additionalDevices: site.additionalDevices,
        dailyDose: site.dailyDose,
        totalDose: site.totalDose
      }))
    });

    const detail = service.getPatientDetail(patient.id);
    expect(detail.courses[0].course.prescribedFractions).toBe(12);
    expect(detail.courses[0].visits).toHaveLength(1);

    const dashboardRow = service.getDashboardSnapshot().activeCourses.find((row) => row.courseId === course.id);
    expect(dashboardRow?.prescribedFractions).toBe(12);
  });

  it("opens the next unsaved note in order and promotes a sim consult course after first treatment saves prescribed fractions", async () => {
    const patient = service.savePatient({
      firstName: "Mickey",
      lastName: "Mouse",
      mrn: "MRN-2002",
      dob: "1975-06-10",
      notes: ""
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Left cheek course",
      courseType: "one_site",
      prescribedFractions: 0,
      startDate: "2026-04-03",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Left cheek",
          treatmentLocationText: "Left cheek",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 0,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "Open Cone",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "None",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    const before = service.getDashboardSnapshot().activeCourses.find((row) => row.courseId === course.id);
    expect(before?.prescribedFractions).toBe(0);

    const consultDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(consultDraft.note.noteType).toBe("consult_sim");
    service.saveVisit(consultDraft.note);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.noteType).toBe("first_fraction");
    expect(firstDraft.note.structuredFields.prescribedFractionsInput).toBeNull();
    expect(firstDraft.note.structuredFields.siteSnapshots[0]?.dailyDose).toBe(400);
    expect(firstDraft.note.structuredFields.siteSnapshots[0]?.totalDose).toBe(4000);

    firstDraft.note.structuredFields.prescribedFractionsInput = 10;
    const savedFirst = service.saveVisit(firstDraft.note);
    expect(savedFirst.generatedText).toContain("Number of Treatments: 10");

    const updatedCourse = service.getPatientDetail(patient.id).courses[0].course;
    expect(updatedCourse.prescribedFractions).toBe(10);

    const after = service.getDashboardSnapshot().activeCourses.find((row) => row.courseId === course.id);
    expect(after?.prescribedFractions).toBe(10);
    expect(after?.currentFraction).toBe(1);

    const nextDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(nextDraft.note.noteType).toBe("standard_treatment");
    expect(nextDraft.note.treatmentNumber).toBe(2);
  });

  it("keeps separate per-lesion projected and prescribed fractions for a two-site course", async () => {
    const { patient, course } = await createTwoSitePatientAndCourse();

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    consultDraft.note.structuredFields.siteSnapshots = consultDraft.note.structuredFields.siteSnapshots.map((site) => ({
      ...site,
      prescribedFractions: site.siteNumber === 1 ? 8 : 12
    }));
    consultDraft.note.structuredFields.projectedFractionsInput = 12;
    const savedConsult = service.saveVisit(consultDraft.note);

    const reopenedConsult = service.buildVisitDraft(course.id, "consult_sim", savedConsult.id);
    expect(
      reopenedConsult.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 1)?.prescribedFractions
    ).toBe(8);
    expect(
      reopenedConsult.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 2)?.prescribedFractions
    ).toBe(12);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.noteType).toBe("first_fraction");
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 1)?.prescribedFractions
    ).toBe(8);
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 2)?.prescribedFractions
    ).toBe(12);
    expect(firstDraft.note.structuredFields.prescribedFractionsInput).toBe(12);
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 1)?.dailyDose
    ).toBe(500);
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 1)?.totalDose
    ).toBe(4000);
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 2)?.dailyDose
    ).toBe(350);
    expect(
      firstDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 2)?.totalDose
    ).toBe(4200);

    firstDraft.note.structuredFields.siteSnapshots = firstDraft.note.structuredFields.siteSnapshots.map((site) => ({
      ...site,
      prescribedFractions: site.siteNumber === 1 ? 9 : 14
    }));
    firstDraft.note.structuredFields.prescribedFractionsInput = 14;
    const savedFirst = service.saveVisit(firstDraft.note);
    expect(savedFirst.generatedText).toContain("Total Treatments: 9");
    expect(savedFirst.generatedText).toContain("Total Treatments: 14");

    const detail = service.getPatientDetail(patient.id).courses[0];
    expect(detail.course.prescribedFractions).toBe(14);
    expect(detail.sites.find((site) => site.siteNumber === 1)?.prescribedFractions).toBe(9);
    expect(detail.sites.find((site) => site.siteNumber === 2)?.prescribedFractions).toBe(14);

    const secondDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(secondDraft.note.treatmentNumber).toBe(2);
    expect(
      secondDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 1)?.prescribedFractions
    ).toBe(9);
    expect(
      secondDraft.note.structuredFields.siteSnapshots.find((site) => site.siteNumber === 2)?.prescribedFractions
    ).toBe(14);
  });

  it("shows prescribed fractions on treatment 2+ only when the course still has none, then hides it after save", async () => {
    const patient = service.savePatient({
      firstName: "Later",
      lastName: "Entry",
      mrn: "MRN-3003",
      dob: "1980-01-15",
      notes: ""
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Temple course",
      courseType: "one_site",
      prescribedFractions: 0,
      startDate: "2026-04-03",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Temple",
          treatmentLocationText: "Temple",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 0,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "Open Cone",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "None",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    const consultDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(consultDraft.note);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.noteType).toBe("first_fraction");
    expect(firstDraft.note.structuredFields.prescribedFractionsInput).toBeNull();
    service.saveVisit(firstDraft.note);

    const secondDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(secondDraft.note.noteType).toBe("standard_treatment");
    expect(secondDraft.note.treatmentNumber).toBe(2);
    expect(secondDraft.note.structuredFields.prescribedFractionsInput).toBeNull();

    secondDraft.note.structuredFields.prescribedFractionsInput = 12;
    service.saveVisit(secondDraft.note);

    const updatedCourse = service.getPatientDetail(patient.id).courses[0].course;
    expect(updatedCourse.prescribedFractions).toBe(12);

    const thirdDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(thirdDraft.note.treatmentNumber).toBe(3);
    expect(thirdDraft.course.prescribedFractions).toBe(12);
  });

  it("maps first-treatment doses from prescribed fractions and stores them on the course", async () => {
    const patient = service.savePatient({
      firstName: "Dose",
      lastName: "Map",
      mrn: "MRN-DOSE",
      dob: "1981-03-11",
      notes: ""
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Dose Mapping Course",
      courseType: "one_site",
      prescribedFractions: 0,
      startDate: "2026-04-03",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Temple",
          treatmentLocationText: "Temple",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 0,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "Open Cone",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "None",
          dailyDose: 0,
          totalDose: 0
        }
      ]
    });

    const consultDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(consultDraft.note);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    firstDraft.note.structuredFields.prescribedFractionsInput = 12;
    firstDraft.note.structuredFields.siteSnapshots = firstDraft.note.structuredFields.siteSnapshots.map((site) => ({
      ...site,
      prescribedFractions: 12
    }));
    const savedFirst = service.saveVisit(firstDraft.note);

    expect(savedFirst.structuredFields.siteSnapshots[0]?.dailyDose).toBe(350);
    expect(savedFirst.structuredFields.siteSnapshots[0]?.totalDose).toBe(4200);
    expect(savedFirst.structuredFields.siteSnapshots[0]?.cumulativeDose).toBe(350);

    const updatedDetail = service.getPatientDetail(patient.id).courses[0];
    expect(updatedDetail.course.prescribedFractions).toBe(12);
    expect(updatedDetail.sites[0]?.dailyDose).toBe(350);
    expect(updatedDetail.sites[0]?.totalDose).toBe(4200);
  });

  it("preserves manual dose overrides when a first-treatment note is reopened", async () => {
    const patient = service.savePatient({
      firstName: "Manual",
      lastName: "Override",
      mrn: "MRN-MANUAL",
      dob: "1982-07-21",
      notes: ""
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Manual Dose Course",
      courseType: "one_site",
      prescribedFractions: 0,
      startDate: "2026-04-03",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Temple",
          treatmentLocationText: "Temple",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 0,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "Open Cone",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "None",
          dailyDose: 0,
          totalDose: 0
        }
      ]
    });

    const consultDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(consultDraft.note);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    firstDraft.note.structuredFields.prescribedFractionsInput = 10;
    firstDraft.note.structuredFields.siteSnapshots = firstDraft.note.structuredFields.siteSnapshots.map((site) => ({
      ...site,
      prescribedFractions: 10,
      dailyDose: 450,
      totalDose: 4050,
      cumulativeDose: 450,
      doseManuallyAdjusted: true
    }));
    const savedFirst = service.saveVisit(firstDraft.note);

    expect(savedFirst.structuredFields.siteSnapshots[0]?.dailyDose).toBe(450);
    expect(savedFirst.structuredFields.siteSnapshots[0]?.totalDose).toBe(4050);
    expect(savedFirst.structuredFields.siteSnapshots[0]?.doseManuallyAdjusted).toBe(true);

    const reopenedFirst = service.buildVisitDraft(course.id, "next_treatment", savedFirst.id);
    expect(reopenedFirst.note.structuredFields.siteSnapshots[0]?.dailyDose).toBe(450);
    expect(reopenedFirst.note.structuredFields.siteSnapshots[0]?.totalDose).toBe(4050);
    expect(reopenedFirst.note.structuredFields.siteSnapshots[0]?.doseManuallyAdjusted).toBe(true);
  });

  it("renders consult note text with patient information first instead of an internal title line", async () => {
    const { course } = await createPatientAndCourse();
    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");

    expect(consultDraft.note.generatedText.startsWith("Name: Ava Derm")).toBe(true);
    expect(consultDraft.note.generatedText).not.toContain("1 Site Radiation Therapy Consult / Simulation Note");
    expect(consultDraft.note.generatedText).toContain("HPI:");
    expect(consultDraft.note.generatedText).toContain("This is a");
    expect(consultDraft.note.generatedText).toContain("Biopsy date: 03/30/2026.");
    expect(consultDraft.note.generatedText).toContain(
      "The following treatment devices and target prescriptions were utilized pending radiation oncologist and medical physics review:"
    );
    expect(consultDraft.note.generatedText).not.toContain("mm mm");

    consultDraft.note.structuredFields.projectedFractionsInput = 12;
    consultDraft.note.structuredFields.siteSnapshots = consultDraft.note.structuredFields.siteSnapshots.map((site) => ({
      ...site,
      prescribedFractions: undefined
    }));
    consultDraft.note.generatedText = "";
    consultDraft.note.editedText = "";
    const savedConsult = service.saveVisit(consultDraft.note);

    expect(savedConsult.generatedText).toContain("Tx site name: Bridge of nose");
    expect(savedConsult.generatedText).toContain("ICD10: C44.311");
    expect(savedConsult.generatedText).toContain("Total Fractions: 12");
    expect(savedConsult.generatedText).toContain("Daily dose: 350 cGy");
    expect(savedConsult.generatedText).toContain("Prescribed dose: 4200 cGy");
    expect(savedConsult.generatedText).not.toContain("Cumulative dose:");
    expect(savedConsult.generatedText).toContain("Tx depth: 3mm");
    expect(savedConsult.generatedText).toContain("Cone size: 30mm");
    expect(savedConsult.generatedText).toContain("Cutout flex shield size: 18mm");
    expect(savedConsult.generatedText).toContain("Additional Tx devices: Special Set-up - Custom cutout");
    expect(savedConsult.generatedText).not.toContain("Applicator:");
    expect(savedConsult.generatedText).not.toContain("Flex Shield (Cutout Used):");
  });

  it("renders fuller first fraction and otv wording from the updated sample-based templates", async () => {
    const { course } = await createPatientAndCourse();

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.generatedText).toContain("HPI:");
    expect(firstDraft.note.generatedText).toContain("Last seen on 03/30/2026 for Simulation and Consultation for XRT Treatment.");
    expect(firstDraft.note.generatedText).not.toContain("mm mm");
    expect(firstDraft.note.generatedText).toContain("Radiation Therapy Prescription:");
    expect(firstDraft.note.generatedText).toContain(
      'Comments: See document named "Radiation Therapy Dose Calcs" attached to patient chart'
    );
    service.saveVisit(firstDraft.note);

    const secondDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(secondDraft.note.generatedText).toContain(`Patient was last seen on ${formatDisplayDate(firstDraft.note.visitDate)} for XRT treatment.`);

    for (let index = 0; index < 3; index += 1) {
      const draft = service.buildVisitDraft(course.id, "next_treatment");
      service.saveVisit(draft.note);
    }

    const otvDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(otvDraft.note.noteType).toBe("otv");
    expect(otvDraft.note.generatedText).toContain("Plan: Radiation Physics Consultation.\nLocation: Nasal bridge\nPhysics Consultation: Fraction Number: 5 of 15");
    expect(otvDraft.note.generatedText).toContain(
      "In accordance with the standard of care for radiotherapy treatment"
    );
    expect(otvDraft.note.generatedText).toContain('See attached Documents within patient chart "Weekly Physics Check".');
  });

  it("uses editable OTV notes for one-site and two-site visits", async () => {
    const { course } = await createPatientAndCourse();
    const oneSiteOtvDraft = service.buildVisitDraft(course.id, "next_treatment", undefined, { treatmentNumber: 5 });
    oneSiteOtvDraft.note.structuredFields.examComment = "Custom one-site OTV wording for today.";
    const savedOneSiteOtv = service.saveVisit(oneSiteOtvDraft.note);
    expect(savedOneSiteOtv.generatedText).toContain("Custom one-site OTV wording for today.");

    const patient = service.savePatient({
      firstName: "Tessa",
      lastName: "Two",
      mrn: "MRN-OTV2",
      dob: "1962-02-14",
      sex: "Female",
      notes: ""
    });
    const twoSiteCourse = service.saveCourse({
      patientId: patient.id,
      courseName: "Two Site OTV Course",
      courseType: "two_site",
      prescribedFractions: 10,
      startDate: "2026-04-01",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Left cheek",
          treatmentLocationText: "Left cheek",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "8",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "10",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "",
          dailyDose: 400,
          totalDose: 4000
        },
        {
          siteNumber: 2,
          bodyLocation: "Right ear",
          treatmentLocationText: "Right ear",
          diagnosisText: "Squamous cell carcinoma",
          icd10: "C44.222",
          numberOfBlocks: 1,
          lesionSize: "10",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "12",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });
    const twoSiteOtvDraft = service.buildVisitDraft(twoSiteCourse.id, "next_treatment", undefined, { treatmentNumber: 5 });
    twoSiteOtvDraft.note.structuredFields.examComment = "Custom two-site OTV wording for today.";
    const savedTwoSiteOtv = service.saveVisit(twoSiteOtvDraft.note);
    expect(savedTwoSiteOtv.generatedText).toContain("Custom two-site OTV wording for today.");
  });

  it("only renders final treatment wording on the prescribed final treatment", async () => {
    const { course } = await createPatientAndCourse();
    const earlyDraft = service.buildVisitDraft(course.id, "next_treatment", undefined, { treatmentNumber: 14 });
    earlyDraft.note.structuredFields.finalTreatment = true;
    const savedEarly = service.saveVisit(earlyDraft.note);
    expect(savedEarly.generatedText).not.toContain("Patient successfully completed the prescribed course");

    const finalDraft = service.buildVisitDraft(course.id, "next_treatment", undefined, { treatmentNumber: 15 });
    finalDraft.note.structuredFields.finalTreatment = true;
    const savedFinal = service.saveVisit(finalDraft.note);
    expect(savedFinal.generatedText).toContain("Patient successfully completed the prescribed course");
  });

  it("keeps course-derived values in the live preview when treatment number changes note type", async () => {
    const { patient, course } = await createPatientAndCourse();
    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    const preview = buildVisitPreviewText(
      service.getTemplates(),
      patient,
      course,
      {
        ...firstDraft.note,
        treatmentNumber: 2,
        noteType: "standard_treatment",
        structuredFields: {
          ...firstDraft.note.structuredFields,
          siteSnapshots: firstDraft.note.structuredFields.siteSnapshots.map((site) => ({
            ...site,
            cumulativeDose: site.dailyDose * 2
          }))
        }
      },
      service.getSettingsPayload().settings
    );

    expect(preview).toContain("Current Treatment Number: 2");
    expect(preview).toContain("Current Cumulative Dose to Date: 1000 cGy");
    expect(preview).toContain("Flex Shield (Cutout Used): 18mm");
    expect(preview).toContain("Cone Size: 30mm");
    expect(preview).not.toContain("Cone Size: cone");
  });

  it("allows custom consult biopsy dates and treatment last-treatment dates to flow into regenerated text", async () => {
    const { course } = await createPatientAndCourse();

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    consultDraft.note.structuredFields.biopsyDate = "2026-03-15";
    consultDraft.note.structuredFields.siteSnapshots[0].biopsyDate = "2026-03-15";
    consultDraft.note.generatedText = "";
    consultDraft.note.editedText = "";
    const savedConsult = service.saveVisit(consultDraft.note);
    expect(savedConsult.generatedText).toContain("Biopsy date: 03/15/2026.");

    const treatmentDraft = service.buildVisitDraft(course.id, "next_treatment");
    treatmentDraft.note.structuredFields.lastTreatmentDate = "2026-04-07";
    treatmentDraft.note.generatedText = "";
    treatmentDraft.note.editedText = "";
    const savedTreatment = service.saveVisit(treatmentDraft.note);
    expect(savedTreatment.generatedText).toContain("Last seen on 04/07/2026 for Simulation and Consultation for XRT Treatment.");

    const nextTreatmentDraft = service.buildVisitDraft(course.id, "next_treatment");
    nextTreatmentDraft.note.structuredFields.lastTreatmentDate = "2026-04-08";
    nextTreatmentDraft.note.generatedText = "";
    nextTreatmentDraft.note.editedText = "";
    const savedNextTreatment = service.saveVisit(nextTreatmentDraft.note);
    expect(savedNextTreatment.generatedText).toContain("Patient was last seen on 04/08/2026 for XRT treatment.");
  });

  it("renders separate biopsy dates for two-site consult notes", async () => {
    const { course } = await createTwoSitePatientAndCourse();

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    consultDraft.note.structuredFields.siteSnapshots = consultDraft.note.structuredFields.siteSnapshots.map((site) =>
      site.siteNumber === 1
        ? { ...site, biopsyDate: "2026-04-01", prescribedFractions: 10 }
        : { ...site, biopsyDate: "2026-04-05", prescribedFractions: 12 }
    );
    consultDraft.note.structuredFields.biopsyDate = "2026-04-01";
    consultDraft.note.generatedText = "";
    consultDraft.note.editedText = "";

    const savedConsult = service.saveVisit(consultDraft.note);
    expect(savedConsult.generatedText).toContain(
      "1. is following up for Basal cell carcinoma on the Left cheek. Biopsy date: 04/01/2026."
    );
    expect(savedConsult.generatedText).toContain(
      "2. is following up for Squamous cell carcinoma on the Right ear. Biopsy date: 04/05/2026."
    );
    expect(savedConsult.generatedText).toContain("Tx site name: Left medial malar cheek");
    expect(savedConsult.generatedText).toContain("ICD10: C44.319");
    expect(savedConsult.generatedText).toContain("Total Fractions: 10");
    expect(savedConsult.generatedText).toContain("Daily dose: 400 cGy");
    expect(savedConsult.generatedText).toContain("Prescribed dose: 4000 cGy");
    expect(savedConsult.generatedText).toContain("Tx depth: 3mm");
    expect(savedConsult.generatedText).toContain("Cone size: 20mm");
    expect(savedConsult.generatedText).toContain("Cutout flex shield size: 10mm");
    expect(savedConsult.generatedText).toContain("Tx site name: Right post auricular skin");
    expect(savedConsult.generatedText).toContain("ICD10: C44.222");
    expect(savedConsult.generatedText).toContain("Total Fractions: 12");
    expect(savedConsult.generatedText).toContain("Daily dose: 350 cGy");
    expect(savedConsult.generatedText).toContain("Prescribed dose: 4200 cGy");
    expect(savedConsult.generatedText).toContain("Cutout flex shield size: 12mm");
  });

  it("only includes additional notes when provided and places them above follow up", async () => {
    const { course } = await createPatientAndCourse();

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    expect(consultDraft.note.generatedText).not.toContain("Additional Notes:");

    consultDraft.note.structuredFields.additionalNotes = "Patient prefers afternoon appointments.";
    consultDraft.note.generatedText = "";
    consultDraft.note.editedText = "";
    const savedConsult = service.saveVisit(consultDraft.note);

    expect(savedConsult.generatedText).toContain("Additional Notes:\nPatient prefers afternoon appointments.");
    expect(savedConsult.generatedText.indexOf("Additional Notes:")).toBeLessThan(
      savedConsult.generatedText.indexOf("Follow Up:")
    );
  });

  it("maps simulation complication wording from additional treatment devices and omits it for none", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: originalSite.numberOfBlocks,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: originalSite.cutoutSize,
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: "Ear Shield",
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const earConsult = service.buildVisitDraft(course.id, "consult_sim");
    expect(earConsult.note.generatedText).toContain(
      "The simulation was complicated by the following factors: Proximity to ear (shielding vital organ)"
    );

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: originalSite.numberOfBlocks,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: originalSite.cutoutSize,
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: "None",
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const noComplicationConsult = service.buildVisitDraft(course.id, "consult_sim");
    expect(noComplicationConsult.note.generatedText).not.toContain(
      "The simulation was complicated by the following factors:"
    );
  });

  it("combines multiple treatment devices without repeating shield wording", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: originalSite.numberOfBlocks,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: originalSite.cutoutSize,
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: "Eye Shield, Ear Shield, Nose Shield",
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    expect(consultDraft.note.generatedText).toContain("Additional Tx devices: Eye Shield, Ear Shield, Special Set-up - Nose Shield");
    expect(consultDraft.note.generatedText).toContain(
      "The simulation was complicated by the following factors: Proximity to eye and ear (shielding vital organ)"
    );
  });

  it("auto-derives number of blocks from consult and treatment cutout rules", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: 1,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: "None",
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: originalSite.additionalDevices,
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const treatmentDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(treatmentDraft.note.structuredFields.siteSnapshots[0].numberOfBlocks).toBe(0);
    expect(treatmentDraft.note.generatedText).toContain("Number of Blocks: 0");
    expect(treatmentDraft.note.generatedText).toContain("Open 30mm Cone");

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    expect(consultDraft.note.structuredFields.siteSnapshots[0].numberOfBlocks).toBe(1);
    expect(consultDraft.note.generatedText).toContain("Number of Blocks: 1");
    expect(consultDraft.note.generatedText).toContain("Open Cone");

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: 0,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: "Custom Cutout",
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: originalSite.additionalDevices,
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const customCutoutDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(customCutoutDraft.note.structuredFields.siteSnapshots[0].numberOfBlocks).toBe(1);
    expect(customCutoutDraft.note.generatedText).toContain("Number of Blocks: 1");
  });

  it("uses open cone wording in first-fraction prescription text", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: 0,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: "Open Cone",
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: originalSite.additionalDevices,
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.generatedText).toContain("Flex Shield Cutout Size: Open 30mm Cone");

    const preview = buildVisitPreviewText(
      service.getTemplates(),
      patient,
      course,
      firstDraft.note,
      service.getSettingsPayload().settings
    );
    expect(preview).toContain("Flex Shield Cutout Size: Open 30mm Cone");
  });

  it("normalizes legacy none cutout wording to open cone in edit forms and notes", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          id: originalSite.id,
          siteNumber: originalSite.siteNumber,
          bodyLocation: originalSite.bodyLocation,
          treatmentLocationText: originalSite.treatmentLocationText,
          diagnosisText: originalSite.diagnosisText,
          icd10: originalSite.icd10,
          numberOfBlocks: 0,
          lesionSize: originalSite.lesionSize,
          treatmentDepth: originalSite.treatmentDepth,
          coneSize: originalSite.coneSize,
          cutoutSize: "None",
          shields: originalSite.shields,
          machine: originalSite.machine,
          energyKv: originalSite.energyKv,
          treatmentInterval: originalSite.treatmentInterval,
          additionalDevices: originalSite.additionalDevices,
          dailyDose: originalSite.dailyDose,
          totalDose: originalSite.totalDose
        }
      ]
    });

    const detail = service.getPatientDetail(patient.id);
    const form = createCourseFormFromDetail(detail.courses[0]);
    expect(form.sites[0].cutoutSize).toBe("Open Cone");

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    expect(draft.note.generatedText).toContain("Open 30mm Cone");
    expect(draft.note.generatedText).not.toContain("None");
  });

  it("keeps the desktop app name fixed when saving settings", async () => {
    service.saveSettings({
      appName: "Custom Clinic Name",
      defaultTherapist: "Jamie RT(T)",
      supervisingPhysician: "Dr. Example",
      dermatologyOfficeName: "Dermatherapy",
      dermatologyOfficeLogoAsset: null,
      inactivityTimeoutMinutes: 7
    });

    const settings = service.getSettingsPayload().settings;
    expect(settings.appName).toBe("ClearSkin Hub");
    expect(settings.defaultTherapist).toBe("Jamie RT(T)");
  });

  it("saves physician options and uses the selected supervising physician on notes", async () => {
    const initialPayload = service.getSettingsPayload();
    service.saveSettings({
      ...initialPayload.settings,
      supervisingPhysician: "Avery Bennett, M.D."
    });
    service.rememberSavedOption("physician", "Avery Bennett, M.D.");

    const physicianOption = service
      .getSettingsPayload()
      .savedOptions.find((option) => option.type === "physician" && option.value === "Avery Bennett, M.D.");
    expect(physicianOption).toBeTruthy();

    const { course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.structuredFields.supervisedBy = "Avery Bennett, M.D.";
    const saved = service.saveVisit(draft.note);
    expect(saved.generatedText).toContain("Avery Bennett, M.D. -");

    service.deleteSavedOption(physicianOption!.id);
    expect(service.getSettingsPayload().savedOptions.some((option) => option.id === physicianOption!.id)).toBe(false);
  });

  it("auto-selects note types by treatment number and allows manual override", async () => {
    const { course } = await createPatientAndCourse();

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(firstDraft.note.noteType).toBe("first_fraction");
    const savedFirst = service.saveVisit(firstDraft.note);

    const secondDraft = service.buildVisitDraft(course.id, "next_treatment");
    expect(secondDraft.note.noteType).toBe("standard_treatment");

    secondDraft.note.noteType = "otv";
    const savedSecond = service.saveVisit(secondDraft.note);
    expect(savedSecond.noteType).toBe("otv");

    const third = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(third.note);
    const fourth = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(fourth.note);
    const fifth = service.buildVisitDraft(course.id, "next_treatment");
    expect(fifth.note.noteType).toBe("otv");

    expect(savedFirst.treatmentNumber).toBe(1);
    expect(savedSecond.treatmentNumber).toBe(2);
  });

  it("sorts course visits by sim consult then treatment number after amendments", async () => {
    const { patient, course } = await createPatientAndCourse();

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    service.saveVisit(consultDraft.note);

    const firstDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(firstDraft.note);

    const secondDraft = service.buildVisitDraft(course.id, "next_treatment");
    const savedSecond = service.saveVisit(secondDraft.note);

    const thirdDraft = service.buildVisitDraft(course.id, "next_treatment");
    service.saveVisit(thirdDraft.note);

    const amendedSecond = service.buildVisitDraft(course.id, "next_treatment", savedSecond.id);
    amendedSecond.note.editedText = `${amendedSecond.note.editedText}\nAmended treatment 2.`;
    service.saveVisit(amendedSecond.note);

    const detail = service.getPatientDetail(patient.id);
    expect(detail.courses[0].visits.map((visit) => visit.note.treatmentNumber ?? 0)).toEqual([0, 1, 2, 3]);
  });

  it("calculates cumulative dose from treatment number and daily dose", async () => {
    const { course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.treatmentNumber = 4;
    draft.note.structuredFields.siteSnapshots[0].cumulativeDose =
      draft.note.structuredFields.siteSnapshots[0].dailyDose * 4;
    const saved = service.saveVisit(draft.note);
    expect(saved.structuredFields.siteSnapshots[0].cumulativeDose).toBe(2000);
  });

  it("archives and restores patients and courses", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.completeCourse(course.id);
    service.archivePatient(patient.id);

    let archive = service.listArchive();
    expect(archive.patients.map((detail) => detail.patient.id)).toContain(patient.id);

    service.restorePatient(patient.id);
    service.restoreCourse(course.id);
    archive = service.listArchive();
    expect(archive.patients.find((detail) => detail.patient.id === patient.id)).toBeUndefined();
    expect(service.getDashboardSnapshot().activeCourses.some((row) => row.courseId === course.id)).toBe(true);
  });

  it("removes patients from completed once they have a new active course", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.completeCourse(course.id);

    let completed = service.listCompleted();
    expect(completed.patients.map((detail) => detail.patient.id)).toContain(patient.id);

    service.saveCourse({
      patientId: patient.id,
      courseName: "Forehead follow-up course",
      courseType: "one_site",
      prescribedFractions: 0,
      startDate: "2026-04-03",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Forehead",
          treatmentLocationText: "Forehead",
          diagnosisText: "Basal Cell Carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 0,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "Open Cone",
          shields: "",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "None",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    completed = service.listCompleted();
    expect(completed.patients.find((detail) => detail.patient.id === patient.id)).toBeUndefined();
    expect(service.getDashboardSnapshot().activeCourses.some((row) => row.patientId === patient.id)).toBe(true);
  });

  it("keeps completed patients out of archive until the patient is actually archived", async () => {
    const { patient, course } = await createPatientAndCourse();
    service.completeCourse(course.id);

    const completed = service.listCompleted();
    const archive = service.listArchive();

    expect(completed.patients.map((detail) => detail.patient.id)).toContain(patient.id);
    expect(archive.patients.find((detail) => detail.patient.id === patient.id)).toBeUndefined();
  });

  it("generates PDFs with appended treatment photos and supports regenerate flow", async () => {
    const { course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [
      { name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }
    ];
    draft.note.newAttachmentUploads = [
      { name: "after-photo.png", mimeType: "image/png", dataUrl: pngDataUrl }
    ];

    const saved = service.saveVisit(draft.note);
    const savedPhotos = repository.fetchVisitPhotos(saved.id);
    const savedAttachments = repository.fetchVisitAttachments(saved.id);
    const savedPhotoPath = assetStore.resolveAssetPath(savedPhotos[0]?.imageAsset ?? null) ?? "";
    expect(savedPhotos[0]?.caption).toBe("Bridge of nose tx 1");
    expect(path.basename(savedPhotoPath)).toContain("bridge-of-nose-tx-1");
    expect(savedAttachments[0]?.originalName).toBe("after-photo.png");

    const firstPdf = await service.generatePdf(saved.id);
    const firstPdfPath = assetStore.resolveAssetPath(firstPdf.pdfAsset)!;
    expect(fs.existsSync(firstPdfPath)).toBe(true);
    expect(path.basename(firstPdfPath)).toContain("ava-derm-tx1-note");
    expect(firstPdfPath).toContain(path.join("All Patient Notes", "Treatment Notes", "Derm, Ava"));

    const firstDoc = await PDFDocument.load(fs.readFileSync(firstPdfPath));
    expect(firstDoc.getPageCount()).toBeGreaterThan(2);

    const reopened = service.buildVisitDraft(course.id, "next_treatment", saved.id);
    expect(reopened.existingAttachments).toHaveLength(1);
    reopened.note.editedText += "\n\nManual addendum: physician reviewed skin reaction.";
    const savedAgain = service.saveVisit(reopened.note);
    const secondPdf = await service.generatePdf(savedAgain.id);
    const secondPdfPath = assetStore.resolveAssetPath(secondPdf.pdfAsset)!;

    expect(secondPdf.versionNumber).toBe(2);
    expect(secondPdfPath).not.toBe(firstPdfPath);
  });

  it("stores consult PDFs in the desktop consult folder structure", async () => {
    const { course } = await createPatientAndCourse();
    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    const savedConsult = service.saveVisit(consultDraft.note);
    const consultPdf = await service.generatePdf(savedConsult.id);
    const consultPdfPath = assetStore.resolveAssetPath(consultPdf.pdfAsset)!;

    expect(fs.existsSync(consultPdfPath)).toBe(true);
    expect(consultPdfPath).toContain(path.join("All Patient Notes", "Consult Notes", "Derm, Ava"));
    expect(path.basename(consultPdfPath)).toContain("ava-derm-consult-note");
  });

  it("refreshes reopened draft notes after course edits so regenerated text stays current", async () => {
    const { patient, course } = await createPatientAndCourse();
    const originalSite = repository.fetchSites([course.id])[0];

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          ...originalSite,
          additionalDevices: ""
        }
      ]
    });

    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    const savedConsult = service.saveVisit(consultDraft.note);
    expect(savedConsult.generatedText).not.toContain("Additional Treatment Devices: Eye Shield");

    service.saveCourse({
      id: course.id,
      patientId: patient.id,
      courseName: course.courseName,
      courseType: course.courseType,
      prescribedFractions: course.prescribedFractions,
      startDate: course.startDate,
      endDate: course.endDate,
      status: course.status,
      sites: [
        {
          ...originalSite,
          additionalDevices: "Eye Shield"
        }
      ]
    });

    const reopened = service.buildVisitDraft(course.id, "consult_sim", savedConsult.id);
    expect(reopened.note.generatedText).toContain("Additional Tx devices: Eye Shield");
    expect(reopened.note.editedText).toContain("Additional Tx devices: Eye Shield");

    const resaved = service.saveVisit(reopened.note);
    expect(resaved.generatedText).toContain("Additional Tx devices: Eye Shield");
  });

  it("keeps remembered options hidden and allows a dermatology logo override with default fallback", async () => {
    const initialSettings = service.getSettingsPayload();
    expect(initialSettings.savedOptions).toHaveLength(0);
    expect(initialSettings.settings.dermatologyOfficeLogoAsset).toBeNull();

    const savedSettings = service.saveSettings({
      ...initialSettings.settings,
      defaultTherapist: "Jamie RT(T)",
      dermatologyOfficeLogoUpload: {
        name: "logo.png",
        mimeType: "image/png",
        dataUrl: pngDataUrl
      }
    });

    expect(savedSettings.defaultTherapist).toBe("Jamie RT(T)");
    expect(savedSettings.dermatologyOfficeLogoAsset).toBeTruthy();
    expect(fs.existsSync(assetStore.resolveAssetPath(savedSettings.dermatologyOfficeLogoAsset)!)).toBe(true);
    expect(service.getSettingsPayload().savedOptions).toHaveLength(0);

  const resetSettings = service.saveSettings({
    ...savedSettings,
    removeDermatologyOfficeLogo: true
  });
  expect(resetSettings.dermatologyOfficeLogoAsset).toBeNull();
  });

  it("rebuilds persisted asset resolution across restarts without relying on creation-time mappings", async () => {
    const patient = service.savePatient({
      firstName: "Ida",
      lastName: "Index",
      mrn: "MRN-2222",
      dob: "1975-07-11",
      sex: "Female",
      notes: "",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    expect(patient.facePhoto).toBeTruthy();

    const originalAssetId = patient.facePhoto!.assetId;
    const originalAssetPath = assetStore.resolveAssetPath(patient.facePhoto!)!;

    const restartedAssetStore = new DesktopBinaryAssetStore(path.join(tempDir, "storage"));
    const restartedRepository = new RadiationNoteRepository(tempDir, restartedAssetStore);
    await restartedRepository.initialize();

    expect(restartedAssetStore.resolveAssetPathById(originalAssetId)).toBe(originalAssetPath);

    const reloadedPatient = restartedRepository.fetchPatient(patient.id);
    expect(reloadedPatient?.facePhoto?.assetId).toBe(originalAssetId);
    expect(restartedAssetStore.resolveAssetPath(reloadedPatient!.facePhoto!)).toBe(originalAssetPath);
  });

  it("deletes duplicate notes and removes their files", async () => {
    const { patient, course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    draft.note.newAttachmentUploads = [{ name: "attachment-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];

    const saved = service.saveVisit(draft.note);
    const pdf = await service.generatePdf(saved.id);
    const photo = repository.fetchVisitPhotos(saved.id)[0];
    const attachment = repository.fetchVisitAttachments(saved.id)[0];
    const pdfPath = assetStore.resolveAssetPath(pdf.pdfAsset)!;
    const photoPath = assetStore.resolveAssetPath(photo.imageAsset)!;
    const attachmentPath = assetStore.resolveAssetPath(attachment.fileAsset)!;

    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.existsSync(photoPath)).toBe(true);
    expect(fs.existsSync(attachmentPath)).toBe(true);

    service.deleteVisit(saved.id);

    expect(repository.fetchVisit(saved.id)).toBeNull();
    expect(repository.fetchVisitPhotos(saved.id)).toHaveLength(0);
    expect(repository.fetchVisitAttachments(saved.id)).toHaveLength(0);
    expect(repository.fetchGeneratedPdfs(saved.id)).toHaveLength(0);
    expect(fs.existsSync(pdfPath)).toBe(false);
    expect(fs.existsSync(photoPath)).toBe(false);
    expect(fs.existsSync(attachmentPath)).toBe(false);

    const detail = service.getPatientDetail(patient.id);
    expect(detail.courses[0].visits.some((visit) => visit.note.id === saved.id)).toBe(false);
  });

  it("keeps only one sim consult visit per course", async () => {
    const { patient, course } = await createPatientAndCourse();
    const firstConsultDraft = service.buildVisitDraft(course.id, "consult_sim");
    firstConsultDraft.note.newPhotoUploads = [{ name: "sim-photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const firstConsult = service.saveVisit(firstConsultDraft.note);

    const secondConsultDraft = service.buildVisitDraft(course.id, "consult_sim");
    expect(secondConsultDraft.note.id).toBe(firstConsult.id);
    secondConsultDraft.note.newPhotoUploads = [{ name: "sim-photo-b.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const secondConsult = service.saveVisit(secondConsultDraft.note);

    const detail = service.getPatientDetail(patient.id);
    const consultVisits = detail.courses[0].visits.filter((visit) => visit.note.noteType === "consult_sim");
    expect(consultVisits).toHaveLength(1);
    expect(consultVisits[0].note.id).toBe(secondConsult.id);
    expect(secondConsult.id).toBe(firstConsult.id);
  });

  it("removes empty patient note folders after the last PDF-backed visit is deleted", async () => {
    const { course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    const saved = service.saveVisit(draft.note);
    const pdf = await service.generatePdf(saved.id);
    const pdfPath = assetStore.resolveAssetPath(pdf.pdfAsset)!;
    const patientFolder = path.dirname(pdfPath);

    expect(fs.existsSync(patientFolder)).toBe(true);

    service.deleteVisit(saved.id);

    expect(fs.existsSync(pdfPath)).toBe(false);
    expect(fs.existsSync(patientFolder)).toBe(false);
  });

  it("removes a course and all of its linked notes/files", async () => {
    const { patient, course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    draft.note.newAttachmentUploads = [{ name: "attachment-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];

    const saved = service.saveVisit(draft.note);
    const pdf = await service.generatePdf(saved.id);
    const photo = repository.fetchVisitPhotos(saved.id)[0];
    const attachment = repository.fetchVisitAttachments(saved.id)[0];
    const pdfPath = assetStore.resolveAssetPath(pdf.pdfAsset)!;
    const photoPath = assetStore.resolveAssetPath(photo.imageAsset)!;
    const attachmentPath = assetStore.resolveAssetPath(attachment.fileAsset)!;

    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.existsSync(photoPath)).toBe(true);
    expect(fs.existsSync(attachmentPath)).toBe(true);

    service.deleteCourse(course.id);

    expect(repository.fetchCourse(course.id)).toBeNull();
    expect(repository.fetchSites([course.id])).toHaveLength(0);
    expect(repository.fetchVisit(saved.id)).toBeNull();
    expect(repository.fetchVisitPhotos(saved.id)).toHaveLength(0);
    expect(repository.fetchVisitAttachments(saved.id)).toHaveLength(0);
    expect(repository.fetchGeneratedPdfs(saved.id)).toHaveLength(0);
    expect(fs.existsSync(pdfPath)).toBe(false);
    expect(fs.existsSync(photoPath)).toBe(false);
    expect(fs.existsSync(attachmentPath)).toBe(false);

    const detail = service.getPatientDetail(patient.id);
    expect(detail.courses.some((courseDetail) => courseDetail.course.id === course.id)).toBe(false);
  });

  it("removes empty patient note folders after permanently deleting a patient", async () => {
    const { patient, course } = await createPatientAndCourse();
    const consultDraft = service.buildVisitDraft(course.id, "consult_sim");
    const savedConsult = service.saveVisit(consultDraft.note);
    const consultPdf = await service.generatePdf(savedConsult.id);
    const consultPdfPath = assetStore.resolveAssetPath(consultPdf.pdfAsset)!;
    const consultPatientFolder = path.dirname(consultPdfPath);

    expect(fs.existsSync(consultPatientFolder)).toBe(true);

    service.permanentlyDeletePatient(patient.id);

    expect(fs.existsSync(consultPdfPath)).toBe(false);
    expect(fs.existsSync(consultPatientFolder)).toBe(false);
  });

  it("prepares a full single-patient archive description with structured records and file-backed assets", async () => {
    const patient = service.savePatient({
      firstName: "Ava",
      lastName: "Derm",
      mrn: "MRN-1001",
      dob: "1974-05-22",
      notes: "High-priority lesion check.",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Nasal Bridge Course",
      courseType: "one_site",
      prescribedFractions: 15,
      startDate: "2026-03-30",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Nasal bridge",
          treatmentLocationText: "Bridge of nose",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.311",
          numberOfBlocks: 1,
          lesionSize: "10mm",
          treatmentDepth: "3",
          coneSize: "30",
          cutoutSize: "18",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "Custom cutout",
          dailyDose: 500,
          totalDose: 7500
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    draft.note.newAttachmentUploads = [{ name: "attachment-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const saved = service.saveVisit(draft.note);
    await service.generatePdf(saved.id);

    service.completeCourse(course.id);
    const prepared = service.preparePatientArchive(patient.id);

    expect(prepared.manifest.archiveType).toBe("patient_archive");
    expect(prepared.manifest.archiveVersion).toBe(1);
    expect(prepared.manifest.patientIdentity).toEqual({
      firstName: "Ava",
      lastName: "Derm",
      mrn: "MRN-1001",
      dob: "1974-05-22"
    });
    expect(prepared.manifest.suggestedRestoreBucket).toBe("completed_patients");
    expect(prepared.payload.courses).toHaveLength(1);
    expect(prepared.payload.sites).toHaveLength(1);
    expect(prepared.payload.visitNotes).toHaveLength(1);
    expect(prepared.payload.visitPhotos).toHaveLength(1);
    expect(prepared.payload.visitAttachments).toHaveLength(1);
    expect(prepared.payload.generatedPdfs).toHaveLength(1);
    expect(prepared.assets.map((asset) => asset.category).sort()).toEqual([
      "generated_pdf",
      "patient_face_photo",
      "visit_attachment",
      "visit_photo"
    ]);
    expect(prepared.assets.every((asset) => asset.packagePath.startsWith("files/"))).toBe(true);
    expect(prepared.assets.every((asset) => asset.availableLocally)).toBe(true);
    expect(prepared.warnings).toHaveLength(0);
  });

  it("reports missing local archive assets as preparation warnings", async () => {
    const patient = service.savePatient({
      firstName: "Mia",
      lastName: "Derm",
      mrn: "MRN-2002",
      dob: "1980-01-01",
      notes: "",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    const faceAssetPath = assetStore.resolveAssetPath(patient.facePhoto)!;
    fs.rmSync(faceAssetPath, { force: true });

    const prepared = service.preparePatientArchive(patient.id);

    expect(prepared.assets).toHaveLength(1);
    expect(prepared.assets[0].availableLocally).toBe(false);
    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.warnings[0].code).toBe("missing_asset_file");
  });

  it("exports a real patient archive ZIP with manifest, payload json, and bundled files", async () => {
    const patient = service.savePatient({
      firstName: "Zoe",
      lastName: "Archive",
      mrn: "MRN-3003",
      dob: "1970-09-09",
      notes: "Archive me",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Scalp Course",
      courseType: "one_site",
      prescribedFractions: 10,
      startDate: "2026-03-30",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Scalp",
          treatmentLocationText: "Scalp",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.41",
          numberOfBlocks: 1,
          lesionSize: "8mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "13",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "Ear Shield",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    draft.note.newAttachmentUploads = [{ name: "attachment-a.pdf", mimeType: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovS2lkcyBbMyAwIFJdCi9Db3VudCAxCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMiAwIFIKL01lZGlhQm94IFswIDAgMjAwIDIwMF0KL0NvbnRlbnRzIDQgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9MZW5ndGggNDQKPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgoxMCAxMCBUZAooQXR0YWNobWVudCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQo+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMTkyIDAwMDAwIG4gCjAwMDAwMDAyODcgMDAwMDAgbiAKdHJhaWxlcgo8PAovUm9vdCAxIDAgUgovU2l6ZSA2Cj4+CnN0YXJ0eHJlZgozNTQKJSVFT0Y=" }];
    const saved = service.saveVisit(draft.note);
    await service.generatePdf(saved.id);

    const exportResult = await service.exportPatientArchive(patient.id);

    expect(fs.existsSync(exportResult.archiveHandle.path)).toBe(true);
    expect(exportResult.archiveHandle.fileName).toContain("archive-zoe");
    expect(exportResult.missingAssetCount).toBe(0);

    const zip = await JSZip.loadAsync(fs.readFileSync(exportResult.archiveHandle.path));
    const entries = Object.keys(zip.files).sort();

    expect(entries).toContain("manifest.json");
    expect(entries).toContain("patient.json");
    expect(entries).toContain("courses.json");
    expect(entries).toContain("sites.json");
    expect(entries).toContain("visit-notes.json");
    expect(entries).toContain("visit-photos.json");
    expect(entries).toContain("visit-attachments.json");
    expect(entries).toContain("generated-pdfs.json");
    expect(entries).toContain("asset-descriptors.json");
    expect(entries).toContain("warnings.json");
    expect(entries.some((entry) => entry.startsWith(`files/patients/${patient.id}/`))).toBe(true);
    expect(entries.some((entry) => entry.includes(`/photos/`))).toBe(true);
    expect(entries.some((entry) => entry.includes(`/attachments/`))).toBe(true);
    expect(entries.some((entry) => entry.includes(`/pdfs/`))).toBe(true);

    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.archiveType).toBe("patient_archive");
    expect(manifest.patientId).toBe(patient.id);
  });

  it("reads a real patient archive ZIP into an in-memory imported archive description", async () => {
    const patient = service.savePatient({
      firstName: "Rita",
      lastName: "Reader",
      mrn: "MRN-4004",
      dob: "1968-11-04",
      notes: "Ready for archive read test.",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Temple Course",
      courseType: "one_site",
      prescribedFractions: 8,
      startDate: "2026-04-01",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Temple",
          treatmentLocationText: "Right temple",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "6mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "12",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "Eye shield",
          dailyDose: 400,
          totalDose: 3200
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const saved = service.saveVisit(draft.note);
    await service.generatePdf(saved.id);

    const exportResult = await service.exportPatientArchive(patient.id);
    const readResult = await service.readPatientArchive(exportResult.archiveHandle);

    expect(readResult.isValid).toBe(true);
    expect(readResult.issues).toHaveLength(0);
    expect(readResult.archive).not.toBeNull();
    expect(readResult.archive?.manifest.archiveType).toBe("patient_archive");
    expect(readResult.archive?.manifest.archiveVersion).toBe(1);
    expect(readResult.archive?.manifest.patientId).toBe(patient.id);
    expect(readResult.archive?.payload.patient.id).toBe(patient.id);
    expect(readResult.archive?.payload.courses).toHaveLength(1);
    expect(readResult.archive?.payload.sites).toHaveLength(1);
    expect(readResult.archive?.payload.visitNotes).toHaveLength(1);
    expect(readResult.archive?.payload.visitPhotos).toHaveLength(1);
    expect(readResult.archive?.payload.generatedPdfs).toHaveLength(1);
    expect(readResult.archive?.assets.some((asset) => asset.category === "patient_face_photo")).toBe(true);
    expect(readResult.archive?.fileEntries.some((entry) => entry.packagePath === "manifest.json")).toBe(true);
    expect(readResult.archive?.fileEntries.some((entry) => entry.packagePath.startsWith("files/"))).toBe(true);
  });

  it("reports explicit validation issues for malformed or incomplete archive ZIPs", async () => {
    const missingEntryZip = new JSZip();
    missingEntryZip.file(
      "manifest.json",
      JSON.stringify({
        archiveType: "patient_archive",
        archiveVersion: 999,
        preparedAt: "2026-04-03T12:00:00.000Z",
        patientId: "patient_missing"
      })
    );
    missingEntryZip.file(
      "patient.json",
      JSON.stringify({ id: "patient_missing", firstName: "Bad", lastName: "Zip", mrn: "MRN-X", dob: "1970-01-01" })
    );
    missingEntryZip.file("courses.json", "[]");
    missingEntryZip.file("sites.json", "[]");
    missingEntryZip.file("visit-notes.json", "[]");
    missingEntryZip.file("visit-photos.json", "[]");
    missingEntryZip.file("visit-attachments.json", "[]");
    missingEntryZip.file("generated-pdfs.json", "[]");
    missingEntryZip.file("warnings.json", "[]");
    const missingEntryArchivePath = path.join(tempDir, "broken-patient-archive-missing-entry.zip");
    fs.writeFileSync(missingEntryArchivePath, await missingEntryZip.generateAsync({ type: "nodebuffer" }));

    const missingEntryReadResult = await service.readPatientArchive({
      kind: "desktop_path",
      path: missingEntryArchivePath,
      fileName: path.basename(missingEntryArchivePath)
    });

    expect(missingEntryReadResult.isValid).toBe(false);
    expect(missingEntryReadResult.archive).toBeNull();
    expect(missingEntryReadResult.issues.map((issue) => issue.code)).toContain("missing_required_entry");

    const invalidVersionZip = new JSZip();
    invalidVersionZip.file(
      "manifest.json",
      JSON.stringify({
        archiveType: "patient_archive",
        archiveVersion: 999,
        preparedAt: "2026-04-03T12:00:00.000Z",
        patientId: "patient_invalid"
      })
    );
    invalidVersionZip.file(
      "patient.json",
      JSON.stringify({ id: "patient_invalid", firstName: "Bad", lastName: "Version", mrn: "MRN-Y", dob: "1971-02-02" })
    );
    invalidVersionZip.file("courses.json", "[]");
    invalidVersionZip.file("sites.json", "[]");
    invalidVersionZip.file("visit-notes.json", "[]");
    invalidVersionZip.file("visit-photos.json", "[]");
    invalidVersionZip.file("visit-attachments.json", "[]");
    invalidVersionZip.file("generated-pdfs.json", "[]");
    invalidVersionZip.file("asset-descriptors.json", "[]");
    invalidVersionZip.file("warnings.json", "[]");
    const invalidVersionArchivePath = path.join(tempDir, "broken-patient-archive-invalid-version.zip");
    fs.writeFileSync(invalidVersionArchivePath, await invalidVersionZip.generateAsync({ type: "nodebuffer" }));

    const invalidVersionReadResult = await service.readPatientArchive({
      kind: "desktop_path",
      path: invalidVersionArchivePath,
      fileName: path.basename(invalidVersionArchivePath)
    });

    expect(invalidVersionReadResult.isValid).toBe(false);
    expect(invalidVersionReadResult.archive).not.toBeNull();
    expect(invalidVersionReadResult.issues.map((issue) => issue.code)).toContain("unsupported_archive_version");
  });

  it("preflights a completed-history archive as supported before restore", async () => {
    const patient = service.savePatient({
      firstName: "Paula",
      lastName: "Preview",
      mrn: "MRN-4555",
      dob: "1977-01-19",
      sex: "Female",
      notes: "Preflight me."
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Temple Course",
      courseType: "one_site",
      prescribedFractions: 5,
      startDate: "2026-03-01",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Temple",
          treatmentLocationText: "Left temple",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "9mm",
          treatmentDepth: "3",
          coneSize: "25",
          cutoutSize: "14",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "daily",
          additionalDevices: "",
          dailyDose: 500,
          totalDose: 2500
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    const savedVisit = service.saveVisit(draft.note);
    await service.generatePdf(savedVisit.id);
    service.completeCourse(course.id);

    const exportResult = await service.exportPatientArchive(patient.id);
    const preflightResult = await service.preflightPatientArchive(exportResult.archiveHandle);

    expect(preflightResult.status).toBe("supported");
    expect(preflightResult.restoreMode).toBe("merge_existing_patient");
    expect(preflightResult.targetPatientId).toBe(patient.id);
    expect(preflightResult.manifest?.patientIdentity.firstName).toBe("Paula");
    expect(preflightResult.validationIssues).toHaveLength(0);
    expect(preflightResult.restoreBlockers).toHaveLength(0);
  });

  it("restores a valid patient archive into a fresh local store and lands the patient in Completed Patients", async () => {
    const patient = service.savePatient({
      firstName: "Nora",
      lastName: "Restore",
      mrn: "MRN-5005",
      dob: "1978-03-14",
      sex: "Female",
      notes: "Restore test patient.",
      facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
    });

    const course = service.saveCourse({
      patientId: patient.id,
      courseName: "Cheek Course",
      courseType: "one_site",
      prescribedFractions: 10,
      startDate: "2026-04-01",
      endDate: "2026-04-15",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Cheek",
          treatmentLocationText: "Left cheek",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "7mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "12",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "Eye shield",
          dailyDose: 400,
          totalDose: 4000
        }
      ]
    });

    const draft = service.buildVisitDraft(course.id, "next_treatment");
    draft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    draft.note.newAttachmentUploads = [{ name: "attachment-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
    const savedVisit = service.saveVisit(draft.note);
    await service.generatePdf(savedVisit.id);
    service.completeCourse(course.id);

    const exportResult = await service.exportPatientArchive(patient.id);

    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-note-restore-"));
    try {
      const restoreAssetStore = new DesktopBinaryAssetStore(path.join(restoreDir, "storage"));
      const restoreRepository = new RadiationNoteRepository(restoreDir, restoreAssetStore);
      const restoreService = new RadiationNoteService(
        restoreRepository,
        restoreAssetStore,
        path.join(restoreDir, "All Patient Notes"),
        undefined,
        path.join(restoreDir, "Patient Archives")
      );
      await restoreService.initialize();

      const restoreResult = await restoreService.restorePatientArchive(exportResult.archiveHandle);

      expect(restoreResult.status).toBe("restored");
      expect(restoreResult.blockers).toHaveLength(0);
      expect(restoreResult.patientId).toBe(patient.id);
      expect(restoreResult.restoredCounts?.courses).toBe(1);
      expect(restoreResult.restoredCounts?.visitNotes).toBe(1);
      expect(restoreResult.restoredCounts?.visitPhotos).toBe(1);
      expect(restoreResult.restoredCounts?.visitAttachments).toBe(1);
      expect(restoreResult.restoredCounts?.generatedPdfs).toBe(1);

      const completed = restoreService.listCompleted();
      expect(completed.patients).toHaveLength(1);
      expect(completed.patients[0].patient.id).toBe(patient.id);

      const restoredDetail = restoreService.getPatientDetail(patient.id);
      expect(restoredDetail.patient.facePhoto).toBeTruthy();
      expect(restoredDetail.courses).toHaveLength(1);
      expect(restoredDetail.courses[0].course.status).toBe("completed");
      expect(restoredDetail.courses[0].visits).toHaveLength(1);
      expect(restoredDetail.courses[0].visits[0].photos).toHaveLength(1);
      expect(restoredDetail.courses[0].visits[0].attachments).toHaveLength(1);
      expect(restoredDetail.courses[0].visits[0].pdfs).toHaveLength(1);

      const restoredFacePath = restoreAssetStore.resolveAssetPath(restoredDetail.patient.facePhoto)!;
      const restoredPhotoPath = restoreAssetStore.resolveAssetPath(restoredDetail.courses[0].visits[0].photos[0].imageAsset)!;
      const restoredAttachmentPath = restoreAssetStore.resolveAssetPath(
        restoredDetail.courses[0].visits[0].attachments[0].fileAsset
      )!;
      const restoredPdfPath = restoreAssetStore.resolveAssetPath(restoredDetail.courses[0].visits[0].pdfs[0].fileAsset)!;

      expect(fs.existsSync(restoredFacePath)).toBe(true);
      expect(fs.existsSync(restoredPhotoPath)).toBe(true);
      expect(fs.existsSync(restoredAttachmentPath)).toBe(true);
      expect(fs.existsSync(restoredPdfPath)).toBe(true);
      expect(restoredPdfPath).toContain(path.join("All Patient Notes", "Treatment Notes", "Restore, Nora"));
    } finally {
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it("merges a same-identity imported archive into the existing local patient without creating a duplicate", async () => {
    const canonicalPatient = service.savePatient({
      firstName: "Maya",
      lastName: "Merge",
      mrn: "MRN-6006",
      dob: "1972-08-21",
      sex: "Female",
      notes: "Canonical local patient."
    });

    const existingCourse = service.saveCourse({
      patientId: canonicalPatient.id,
      courseName: "Existing Completed Course",
      courseType: "one_site",
      prescribedFractions: 5,
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      sites: [
        {
          siteNumber: 1,
          bodyLocation: "Forehead",
          treatmentLocationText: "Forehead",
          diagnosisText: "Basal cell carcinoma",
          icd10: "C44.319",
          numberOfBlocks: 1,
          lesionSize: "5mm",
          treatmentDepth: "3",
          coneSize: "20",
          cutoutSize: "10",
          shields: "Flex shield",
          machine: "Xoft Elekta 1200 SPX",
          energyKv: "50kV",
          treatmentInterval: "bi-weekly",
          additionalDevices: "",
          dailyDose: 400,
          totalDose: 2000
        }
      ]
    });
    service.completeCourse(existingCourse.id);

    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-note-merge-source-"));
    try {
      const importAssetStore = new DesktopBinaryAssetStore(path.join(importDir, "storage"));
      const importRepository = new RadiationNoteRepository(importDir, importAssetStore);
      const importService = new RadiationNoteService(
        importRepository,
        importAssetStore,
        path.join(importDir, "All Patient Notes"),
        undefined,
        path.join(importDir, "Patient Archives")
      );
      await importService.initialize();

      const importedPatient = importService.savePatient({
        firstName: "Maya",
        lastName: "Merge",
        mrn: "MRN-6006",
        dob: "1972-08-21",
        sex: "Female",
        notes: "Imported history",
        facePhotoUpload: { name: "face.png", mimeType: "image/png", dataUrl: pngDataUrl }
      });

      const importedCourse = importService.saveCourse({
        patientId: importedPatient.id,
        courseName: "Imported Completed Course",
        courseType: "one_site",
        prescribedFractions: 8,
        startDate: "2026-04-01",
        endDate: "2026-04-15",
        sites: [
          {
            siteNumber: 1,
            bodyLocation: "Cheek",
            treatmentLocationText: "Left cheek",
            diagnosisText: "Basal cell carcinoma",
            icd10: "C44.319",
            numberOfBlocks: 1,
            lesionSize: "6mm",
            treatmentDepth: "3",
            coneSize: "20",
            cutoutSize: "12",
            shields: "Flex shield",
            machine: "Xoft Elekta 1200 SPX",
            energyKv: "50kV",
            treatmentInterval: "bi-weekly",
            additionalDevices: "Eye shield",
            dailyDose: 400,
            totalDose: 3200
          }
        ]
      });

      const importedDraft = importService.buildVisitDraft(importedCourse.id, "next_treatment");
      importedDraft.note.newPhotoUploads = [{ name: "photo-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
      importedDraft.note.newAttachmentUploads = [{ name: "attachment-a.png", mimeType: "image/png", dataUrl: pngDataUrl }];
      const importedSavedVisit = importService.saveVisit(importedDraft.note);
      await importService.generatePdf(importedSavedVisit.id);
      importService.completeCourse(importedCourse.id);

      const exportResult = await importService.exportPatientArchive(importedPatient.id);
      const restoreResult = await service.restorePatientArchive(exportResult.archiveHandle);

      expect(restoreResult.status).toBe("restored");
      expect(restoreResult.patientId).toBe(canonicalPatient.id);
      expect(restoreResult.blockers).toHaveLength(0);
      expect(restoreResult.notices.some((notice) => notice.includes("Merged imported archive into existing patient"))).toBe(true);

      const completed = service.listCompleted();
      expect(completed.patients).toHaveLength(1);
      expect(completed.patients[0].patient.id).toBe(canonicalPatient.id);

      const mergedDetail = service.getPatientDetail(canonicalPatient.id);
      expect(mergedDetail.courses).toHaveLength(2);
      expect(mergedDetail.patient.id).toBe(canonicalPatient.id);
      expect(mergedDetail.patient.notes).toBe("Canonical local patient.");

      const mergedCourseNames = mergedDetail.courses.map((courseDetail) => courseDetail.course.courseName);
      expect(mergedCourseNames).toContain("Existing Completed Course");
      expect(mergedCourseNames).toContain("Imported Completed Course");

      const importedMergedCourse = mergedDetail.courses.find((courseDetail) => courseDetail.course.courseName === "Imported Completed Course");
      expect(importedMergedCourse).toBeTruthy();
      expect(importedMergedCourse!.course.patientId).toBe(canonicalPatient.id);
      expect(importedMergedCourse!.course.id).not.toBe(importedCourse.id);
      expect(importedMergedCourse!.visits).toHaveLength(1);
      expect(importedMergedCourse!.visits[0].note.patientId).toBe(canonicalPatient.id);
      expect(importedMergedCourse!.visits[0].note.id).not.toBe(importedSavedVisit.id);
      expect(importedMergedCourse!.visits[0].photos[0].id).not.toBe(importService.getPatientDetail(importedPatient.id).courses[0].visits[0].photos[0].id);
      expect(importedMergedCourse!.visits[0].attachments[0].id).not.toBe(
        importService.getPatientDetail(importedPatient.id).courses[0].visits[0].attachments[0].id
      );
      expect(importedMergedCourse!.visits[0].pdfs[0].id).not.toBe(importService.getPatientDetail(importedPatient.id).courses[0].visits[0].pdfs[0].id);

      const mergedPdfPath = assetStore.resolveAssetPath(importedMergedCourse!.visits[0].pdfs[0].fileAsset)!;
      expect(fs.existsSync(mergedPdfPath)).toBe(true);
      expect(path.basename(mergedPdfPath)).toContain("imported");
      expect(mergedPdfPath).toContain(path.join("All Patient Notes", "Treatment Notes", "Merge, Maya"));
    } finally {
      fs.rmSync(importDir, { recursive: true, force: true });
    }
  });

  it("blocks restore when the imported archive contains active courses that still require broader restore policy", async () => {
    const { patient, course } = await createPatientAndCourse();
    const draft = service.buildVisitDraft(course.id, "next_treatment");
    const savedVisit = service.saveVisit(draft.note);
    await service.generatePdf(savedVisit.id);

    const exportResult = await service.exportPatientArchive(patient.id);
    const preflightResult = await service.preflightPatientArchive(exportResult.archiveHandle);
    const restoreResult = await service.restorePatientArchive(exportResult.archiveHandle);

    expect(preflightResult.status).toBe("blocked");
    expect(preflightResult.restoreBlockers.map((blocker) => blocker.code)).toContain("active_course_not_supported");
    expect(restoreResult.status).toBe("blocked");
    expect(restoreResult.restoredCounts).toBeNull();
    expect(restoreResult.blockers.length).toBeGreaterThan(0);
    expect(restoreResult.blockers.map((blocker) => blocker.code)).toContain("active_course_not_supported");
  });

  it("suggests otv on every 5th treatment including treatment 15", () => {
    expect(getSuggestedNoteType(5)).toBe("otv");
    expect(getSuggestedNoteType(10)).toBe("otv");
    expect(getSuggestedNoteType(15)).toBe("otv");
  });
});
