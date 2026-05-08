import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type {
  AppClient,
  CourseInput,
  DashboardCourseRow,
  DashboardSnapshot,
  PatientInput,
  ScheduleAppointmentInput,
  ScheduleAppointmentRecord,
  ScheduleAppointmentStatus,
  ScheduleAppointmentType,
  ScheduleIntakeSiteInput,
  ScheduleBlockInput,
  ScheduleBlockRecord,
  ScheduleBlockType,
  ScheduleSettingsView,
  ScheduleSnapshot
} from "../../shared/types";
import { CalendarDateInput, DobInput, NumericInput } from "./screen-components";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" }
];
const STATUS_OPTIONS: Array<{ value: ScheduleAppointmentStatus; label: string }> = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "missed", label: "Missed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rescheduled", label: "Rescheduled" }
];
const FRACTION_PRESETS = [8, 10, 12, 15];
const DIAGNOSIS_OPTIONS = [
  "Basal Cell Carcinoma",
  "Squamous Cell Carcinoma",
  "Squamous Cell Carcinoma in-situ"
] as const;

type AppointmentFormState = {
  id?: string;
  source: "linked" | "manual";
  courseId: string;
  patientId: string | null;
  patientName: string;
  patientFirstName: string;
  patientLastName: string;
  patientMrn: string;
  patientDob: string;
  patientSex: string;
  appointmentDate: string;
  startTime: string;
  durationMinutes: number;
  appointmentType: ScheduleAppointmentType;
  appointmentNumber: string;
  totalAppointments: string;
  status: ScheduleAppointmentStatus;
  notes: string;
  recurring: boolean;
  recurringCount: string;
  recurringWeekdays: number[];
  seriesId: string | null;
  moveFollowing: boolean;
  intakeCourseType: Exclude<CourseInput["courseType"], "consult">;
  intakeBiopsyDate: string;
  intakeSites: ScheduleIntakeSiteInput[];
  originalDate?: string;
  originalStartTime?: string;
};

type BlockFormState = {
  id?: string;
  title: string;
  blockDate: string;
  startTime: string;
  endTime: string;
  blockType: ScheduleBlockType;
  isRecurring: boolean;
  recurringWeekdays: number[];
};

type AppointmentDragState = {
  appointment: ScheduleAppointmentRecord;
  pointerId: number;
  startX: number;
  startY: number;
  offsetY: number;
  moved: boolean;
};

type AppointmentDragPreview = {
  appointment: ScheduleAppointmentRecord;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  hasConflict: boolean;
};

type AppointmentMenuState = {
  appointment: ScheduleAppointmentRecord;
  x: number;
  y: number;
  showStatusMenu: boolean;
};

function createEmptyIntakeSite(siteNumber: 1 | 2, source?: ScheduleIntakeSiteInput): ScheduleIntakeSiteInput {
  return {
    siteNumber,
    treatmentLocationText: source?.treatmentLocationText ?? "",
    diagnosisText: source?.diagnosisText ?? "",
    icd10: source?.icd10 ?? "",
    projectedFractions: source?.projectedFractions ?? null
  };
}

function splitStoredPatientName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const commaParts = trimmed.split(",").map((part) => part.trim());
  if (commaParts.length >= 2) {
    return { firstName: commaParts.slice(1).join(" "), lastName: commaParts[0] };
  }
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1)[0] ?? ""
  };
}

function buildPatientName(firstName: string, lastName: string, fallback = "") {
  const first = firstName.trim();
  const last = lastName.trim();
  if (first && last) {
    return `${last}, ${first}`;
  }
  return last || first || fallback.trim();
}

function normalizeMatchValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildCourseNameFromIntakeSites(sites: ScheduleIntakeSiteInput[]) {
  return sites.map((site) => site.treatmentLocationText.trim()).filter(Boolean).join(" + ");
}

function toCourseSiteInput(site: ScheduleIntakeSiteInput): CourseInput["sites"][number] {
  return {
    siteNumber: site.siteNumber,
    bodyLocation: site.treatmentLocationText,
    treatmentLocationText: site.treatmentLocationText,
    diagnosisText: site.diagnosisText,
    icd10: site.icd10,
    numberOfBlocks: 0,
    lesionSize: "",
    treatmentDepth: "3",
    coneSize: "",
    cutoutSize: "",
    shields: "",
    machine: "Xoft Elekta 1200 SPX",
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
    totalDose: 0,
    prescribedFractions: site.projectedFractions ?? undefined
  };
}

function todayIso() {
  return toIsoDate(new Date());
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function getWeekStart(value: string) {
  const date = parseIsoDate(value);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

function formatDayHeader(value: string) {
  const date = parseIsoDate(value);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function formatFullDate(value: string) {
  const date = parseIsoDate(value);
  return date.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  });
}

function formatMonthTitle(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}`.padStart(2, "0") + ":" + `${minutes}`.padStart(2, "0");
}

function formatTime(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${`${minute || 0}`.padStart(2, "0")} ${suffix}`;
}

function isQuarterHour(value: string) {
  const minute = Number(value.split(":")[1]);
  return minute % 15 === 0;
}

function isHour(value: string) {
  return value.endsWith(":00");
}

function getAppointmentEndTime(startTime: string, durationMinutes: number) {
  return minutesToTime(timeToMinutes(startTime) + durationMinutes);
}

function getDuration(startTime: string, endTime: string) {
  return Math.max(5, timeToMinutes(endTime) - timeToMinutes(startTime));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getRowIndex(time: string, clinicStartTime: string) {
  return Math.max(0, Math.round((timeToMinutes(time) - timeToMinutes(clinicStartTime)) / 5));
}

function buildSlots(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const slots: string[] = [];
  for (let minute = start; minute < end; minute += 5) {
    slots.push(minutesToTime(minute));
  }
  return slots;
}

function getCourseDuration(course?: DashboardCourseRow | null) {
  return course?.courseType === "two_site" ? 30 : 15;
}

function getAppointmentTypeLabel(type: ScheduleAppointmentType) {
  if (type === "sim_consult") return "Sim/Consult";
  if (type === "follow_up") return "Follow-up";
  return "Treatment";
}

function getStatusLabel(status: ScheduleAppointmentStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getAppointmentMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }
  return {
    left: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 430)),
    top: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - 280))
  };
}

function getDiagnosisShorthand(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("basal cell")) return "BCC";
  if (normalized.includes("in-situ") || normalized.includes("in situ")) return "SCCis";
  if (normalized.includes("squamous cell")) return "SCC";
  return value.trim();
}

function getAppointmentSiteLabel(appointment: ScheduleAppointmentRecord) {
  const parts = appointment.intakeSites
    .map((site) => {
      const location = site.treatmentLocationText.trim();
      const diagnosis = getDiagnosisShorthand(site.diagnosisText);
      if (location && diagnosis) return `${location} - ${diagnosis}`;
      return location || diagnosis;
    })
    .filter(Boolean);
  return parts.join("; ");
}

function getAppointmentShortLabel(appointment: ScheduleAppointmentRecord) {
  if (appointment.appointmentType === "treatment") {
    const number = appointment.appointmentNumber ? ` ${appointment.appointmentNumber}` : "";
    const total = appointment.totalAppointments ? ` of ${appointment.totalAppointments}` : "";
    return `Treatment${number}${total}`;
  }
  return getAppointmentTypeLabel(appointment.appointmentType);
}

function getPrintAppointmentLabel(appointment: ScheduleAppointmentRecord) {
  return `${formatTime(appointment.startTime)} - ${getAppointmentShortLabel(appointment)}`;
}

function formatScheduleTimeRange(startTime: string, endTime: string) {
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  const startSuffix = start.slice(-2);
  const endSuffix = end.slice(-2);
  if (startSuffix === endSuffix) {
    return `${start.slice(0, -3)}-${end}`;
  }
  return `${start}-${end}`;
}

function createSeriesId() {
  return `series_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(year, monthIndex, 1);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() + 1);
  }
  date.setDate(date.getDate() + (nth - 1) * 7);
  return toIsoDate(date);
}

function lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
  const date = new Date(year, monthIndex + 1, 0);
  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() - 1);
  }
  return toIsoDate(date);
}

function observedFixedHoliday(year: number, monthIndex: number, day: number) {
  const actual = new Date(year, monthIndex, day);
  const observed = new Date(actual);
  if (actual.getDay() === 0) observed.setDate(actual.getDate() + 1);
  if (actual.getDay() === 6) observed.setDate(actual.getDate() - 1);
  return toIsoDate(observed);
}

function getUsHolidayName(value: string) {
  const date = parseIsoDate(value);
  const year = date.getFullYear();
  const holidays = new Map<string, string>([
    [observedFixedHoliday(year, 0, 1), "New Year's Day"],
    [nthWeekdayOfMonth(year, 0, 1, 3), "Martin Luther King Jr. Day"],
    [nthWeekdayOfMonth(year, 1, 1, 3), "Presidents Day"],
    [lastWeekdayOfMonth(year, 4, 1), "Memorial Day"],
    [observedFixedHoliday(year, 5, 19), "Juneteenth"],
    [observedFixedHoliday(year, 6, 4), "Independence Day"],
    [nthWeekdayOfMonth(year, 8, 1, 1), "Labor Day"],
    [nthWeekdayOfMonth(year, 9, 1, 2), "Columbus Day"],
    [observedFixedHoliday(year, 10, 11), "Veterans Day"],
    [nthWeekdayOfMonth(year, 10, 4, 4), "Thanksgiving"],
    [observedFixedHoliday(year, 11, 25), "Christmas Day"]
  ]);
  return holidays.get(value) ?? null;
}

function recurringBlockApplies(block: ScheduleBlockRecord, dateIso: string) {
  if (!block.isRecurring) {
    return block.blockDate === dateIso;
  }
  return block.recurringWeekdays.includes(parseIsoDate(dateIso).getDay());
}

function hasTimeOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return timeToMinutes(leftStart) < timeToMinutes(rightEnd) && timeToMinutes(leftEnd) > timeToMinutes(rightStart);
}

function getDoubleBookingConflict(
  appointments: ScheduleAppointmentRecord[],
  input: ScheduleAppointmentInput,
  ignoreId?: string
) {
  const inputStart = timeToMinutes(input.startTime);
  const inputEnd = timeToMinutes(input.endTime);
  const overlappingAppointments = appointments.filter((appointment) => {
    if (appointment.id === ignoreId) return false;
    if (appointment.status === "cancelled") return false;
    return (
      appointment.appointmentDate === input.appointmentDate &&
      hasTimeOverlap(appointment.startTime, appointment.endTime, input.startTime, input.endTime)
    );
  });

  if (overlappingAppointments.length < 2) {
    return null;
  }

  const checkpoints = [
    inputStart,
    inputEnd,
    ...overlappingAppointments.flatMap((appointment) => [
      clamp(timeToMinutes(appointment.startTime), inputStart, inputEnd),
      clamp(timeToMinutes(appointment.endTime), inputStart, inputEnd)
    ])
  ]
    .filter((minute, index, all) => minute >= inputStart && minute <= inputEnd && all.indexOf(minute) === index)
    .sort((left, right) => left - right);

  for (let index = 0; index < checkpoints.length - 1; index += 1) {
    const segmentStart = checkpoints[index];
    const segmentEnd = checkpoints[index + 1];
    if (segmentEnd <= segmentStart) {
      continue;
    }

    const midpoint = segmentStart + (segmentEnd - segmentStart) / 2;
    const simultaneousAppointments = overlappingAppointments.filter(
      (appointment) => timeToMinutes(appointment.startTime) < midpoint && timeToMinutes(appointment.endTime) > midpoint
    );

    if (simultaneousAppointments.length >= 2) {
      const names = simultaneousAppointments.slice(0, 2).map((appointment) => appointment.patientName).join(" and ");
      return `two appointments (${names}) at ${formatTime(minutesToTime(segmentStart))}`;
    }
  }

  return null;
}

function buildAppointmentLaneMap(appointments: ScheduleAppointmentRecord[]) {
  const sortedAppointments = [...appointments].sort((left, right) =>
    `${left.startTime}|${left.endTime}|${left.id}`.localeCompare(`${right.startTime}|${right.endTime}|${right.id}`)
  );
  const laneEndTimes = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const laneById = new Map<string, number>();

  for (const appointment of sortedAppointments) {
    const start = timeToMinutes(appointment.startTime);
    const end = timeToMinutes(appointment.endTime);
    const lane = laneEndTimes[0] <= start ? 0 : laneEndTimes[1] <= start ? 1 : 1;
    laneEndTimes[lane] = end;
    laneById.set(appointment.id, lane);
  }

  const layout = new Map<string, { lane: number; isDoubleBooked: boolean }>();
  for (const appointment of appointments) {
    const isDoubleBooked = appointments.some(
      (other) =>
        other.id !== appointment.id &&
        hasTimeOverlap(appointment.startTime, appointment.endTime, other.startTime, other.endTime)
    );
    layout.set(appointment.id, {
      lane: laneById.get(appointment.id) ?? 0,
      isDoubleBooked
    });
  }
  return layout;
}

function getAppointmentLaneStyle(layout?: { lane: number; isDoubleBooked: boolean }) {
  if (!layout?.isDoubleBooked) {
    return {};
  }

  return {
    justifySelf: "start",
    width: "calc(50% - 5px)",
    marginLeft: layout.lane === 0 ? "3px" : "calc(50% + 2px)",
    marginRight: "0"
  };
}

function buildDefaultAppointmentForm(dateIso: string, startTime: string): AppointmentFormState {
  return {
    source: "manual",
    courseId: "",
    patientId: null,
    patientName: "",
    patientFirstName: "",
    patientLastName: "",
    patientMrn: "",
    patientDob: "",
    patientSex: "",
    appointmentDate: dateIso,
    startTime,
    durationMinutes: 30,
    appointmentType: "sim_consult",
    appointmentNumber: "",
    totalAppointments: "",
    status: "scheduled",
    notes: "",
    recurring: false,
    recurringCount: "1",
    recurringWeekdays: [],
    seriesId: null,
    moveFollowing: false,
    intakeCourseType: "one_site",
    intakeBiopsyDate: "",
    intakeSites: [createEmptyIntakeSite(1)]
  };
}

function buildLinkedForm(course: DashboardCourseRow, dateIso: string, startTime: string, forceTreatment = false): AppointmentFormState {
  const duration = getCourseDuration(course);
  const isSimConsult = !forceTreatment && course.suggestedNoteType === "consult_sim";
  const startNumber = isSimConsult ? 0 : course.suggestedTreatmentNumber ?? 1;
  const remaining = isSimConsult ? 1 : Math.max(1, course.prescribedFractions - startNumber + 1);
  const patientName = splitStoredPatientName(course.patientName);
  return {
    source: "linked",
    courseId: course.courseId,
    patientId: course.patientId,
    patientName: course.patientName,
    patientFirstName: patientName.firstName,
    patientLastName: patientName.lastName,
    patientMrn: course.patientMrn,
    patientDob: course.patientDob,
    patientSex: "",
    appointmentDate: dateIso,
    startTime,
    durationMinutes: duration,
    appointmentType: isSimConsult ? "sim_consult" : "treatment",
    appointmentNumber: `${startNumber}`,
    totalAppointments: !isSimConsult && course.prescribedFractions ? `${course.prescribedFractions}` : "",
    status: "scheduled",
    notes: "",
    recurring: !isSimConsult,
    recurringCount: `${remaining}`,
    recurringWeekdays: [],
    seriesId: null,
    moveFollowing: false,
    intakeCourseType: course.courseType === "two_site" ? "two_site" : "one_site",
    intakeBiopsyDate: "",
    intakeSites: [createEmptyIntakeSite(1)]
  };
}

function getTreatmentAppointmentCount(form: AppointmentFormState, linkedCourse: DashboardCourseRow | null) {
  if (form.appointmentType !== "treatment") {
    return 1;
  }
  const linkedFractions = linkedCourse?.prescribedFractions && linkedCourse.prescribedFractions > 0
    ? linkedCourse.prescribedFractions
    : null;
  const startNumber = Number(form.appointmentNumber) || linkedCourse?.suggestedTreatmentNumber || 1;
  if (linkedFractions) {
    return Math.max(1, linkedFractions - startNumber + 1);
  }
  return Math.max(1, Number(form.recurringCount) || 1);
}

function appointmentToForm(appointment: ScheduleAppointmentRecord): AppointmentFormState {
  const patientName = splitStoredPatientName(appointment.patientName);
  return {
    id: appointment.id,
    source: appointment.courseId ? "linked" : "manual",
    courseId: appointment.courseId ?? "",
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    patientFirstName: appointment.patientFirstName || patientName.firstName,
    patientLastName: appointment.patientLastName || patientName.lastName,
    patientMrn: appointment.patientMrn,
    patientDob: appointment.patientDob,
    patientSex: appointment.patientSex,
    appointmentDate: appointment.appointmentDate,
    startTime: appointment.startTime,
    durationMinutes: getDuration(appointment.startTime, appointment.endTime),
    appointmentType: appointment.appointmentType,
    appointmentNumber: appointment.appointmentNumber ? `${appointment.appointmentNumber}` : "",
    totalAppointments: appointment.totalAppointments ? `${appointment.totalAppointments}` : "",
    status: appointment.status,
    notes: appointment.notes,
    recurring: false,
    recurringCount: "1",
    recurringWeekdays: [],
    seriesId: appointment.seriesId,
    moveFollowing: false,
    intakeCourseType: appointment.intakeCourseType ?? "one_site",
    intakeBiopsyDate: appointment.intakeBiopsyDate,
    intakeSites: appointment.intakeSites.length ? appointment.intakeSites : [createEmptyIntakeSite(1)],
    originalDate: appointment.appointmentDate,
    originalStartTime: appointment.startTime
  };
}

function blockToForm(block: ScheduleBlockRecord): BlockFormState {
  return {
    id: block.id,
    title: block.title,
    blockDate: block.blockDate ?? todayIso(),
    startTime: block.startTime,
    endTime: block.endTime,
    blockType: block.blockType,
    isRecurring: block.isRecurring,
    recurringWeekdays: block.recurringWeekdays
  };
}

function buildAppointmentInput(
  form: AppointmentFormState,
  appointmentDate: string,
  appointmentNumber: number | null,
  totalAppointments: number | null,
  seriesId: string | null
): ScheduleAppointmentInput {
  const patientName = buildPatientName(form.patientFirstName, form.patientLastName, form.patientName);
  const isSimConsult = form.appointmentType === "sim_consult";
  return {
    id: form.id,
    patientId: form.source === "linked" ? form.patientId : null,
    courseId: form.source === "linked" ? form.courseId : null,
    patientName,
    patientFirstName: form.patientFirstName,
    patientLastName: form.patientLastName,
    patientMrn: form.patientMrn,
    patientDob: form.patientDob,
    patientSex: form.patientSex,
    appointmentDate,
    startTime: form.startTime,
    endTime: getAppointmentEndTime(form.startTime, form.durationMinutes),
    appointmentType: form.appointmentType,
    appointmentNumber,
    totalAppointments,
    status: form.status,
    notes: form.notes,
    seriesId,
    intakeCourseType: isSimConsult ? form.intakeCourseType : null,
    intakeBiopsyDate: isSimConsult ? form.intakeBiopsyDate : "",
    intakeSites: isSimConsult ? form.intakeSites : []
  };
}

function getBlockInput(form: BlockFormState): ScheduleBlockInput {
  return {
    id: form.id,
    title: form.title,
    blockDate: form.isRecurring ? null : form.blockDate,
    startTime: form.startTime,
    endTime: form.endTime,
    blockType: form.blockType,
    isRecurring: form.isRecurring,
    recurringWeekdays: form.isRecurring ? form.recurringWeekdays : []
  };
}

function makeMonthKey(dateIso: string) {
  const date = parseIsoDate(dateIso);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

export function printPatientSchedule(patientName: string, appointments: ScheduleAppointmentRecord[]) {
  const monthKeys = [...new Set(appointments.map((appointment) => makeMonthKey(appointment.appointmentDate)))].sort();
  const appointmentMap = new Map<string, ScheduleAppointmentRecord[]>();
  for (const appointment of appointments) {
    const list = appointmentMap.get(appointment.appointmentDate) ?? [];
    list.push(appointment);
    appointmentMap.set(appointment.appointmentDate, list);
  }

  const monthHtml = monthKeys
    .map((monthKey) => {
      const [yearText, monthText] = monthKey.split("-");
      const year = Number(yearText);
      const monthIndex = Number(monthText) - 1;
      const first = new Date(year, monthIndex, 1);
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const leading = first.getDay();
      const cells: string[] = [];
      for (let i = 0; i < leading; i += 1) {
        cells.push("<td class=\"empty\"></td>");
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const dateIso = toIsoDate(new Date(year, monthIndex, day));
        const dayAppointments = (appointmentMap.get(dateIso) ?? []).sort((left, right) =>
          left.startTime.localeCompare(right.startTime)
        );
        const appointmentHtml = dayAppointments
          .map((appointment) => `<div>${escapeHtml(getPrintAppointmentLabel(appointment))}</div>`)
          .join("");
        cells.push(`<td><strong>${day}</strong>${appointmentHtml}</td>`);
      }
      while (cells.length % 7 !== 0) {
        cells.push("<td class=\"empty\"></td>");
      }

      const rows: string[] = [];
      for (let index = 0; index < cells.length; index += 7) {
        rows.push(`<tr>${cells.slice(index, index + 7).join("")}</tr>`);
      }

      return `
        <section class="month">
          <h2>${escapeHtml(formatMonthTitle(year, monthIndex))}</h2>
          <table>
            <thead><tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const win = window.open("", "_blank");
  if (!win) {
    window.alert("The printable calendar could not open. Please allow pop-ups for this app and try again.");
    return;
  }

  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(patientName)} Schedule</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; margin: 28px; }
          h1 { text-align: center; margin: 0 0 18px; font-size: 28px; }
          h2 { text-align: center; margin: 18px 0 10px; font-size: 24px; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th { border: 1px solid #222; background: #e8e8e8; padding: 5px; font-size: 12px; }
          td { border: 1px solid #222; height: 92px; vertical-align: top; padding: 5px; font-size: 12px; }
          td div { margin-top: 6px; font-weight: 700; }
          .schedule-close {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 10;
            width: 44px;
            height: 44px;
            border: 1px solid #9fb8c9;
            border-radius: 999px;
            background: #fff;
            color: #123a58;
            font: 700 22px Arial, sans-serif;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(18, 58, 88, 0.16);
          }
          .empty { background: #f1f1f1; }
          .month { break-after: page; page-break-after: always; }
          .month:last-child { break-after: auto; page-break-after: auto; }
          @media print {
            .schedule-close { display: none; }
          }
        </style>
      </head>
      <body>
        <button class="schedule-close" type="button" aria-label="Close schedule">X</button>
        <h1>${escapeHtml(patientName)} Treatment Schedule</h1>
        ${monthHtml}
      </body>
    </html>
  `);
  win.document.close();
  win.document.querySelector<HTMLButtonElement>(".schedule-close")?.addEventListener("click", () => win.close());
  win.focus();
  window.setTimeout(() => win.print(), 250);
}

export function ScheduleScreen(props: {
  appClient: AppClient | null;
  initialCourseId?: string;
  onOpenPatient: (patientId: string) => void;
  onStartAppointmentNote: (appointment: ScheduleAppointmentRecord) => void;
  onNotify: (message: string) => void;
}) {
  const [anchorDate, setAnchorDate] = useState(todayIso());
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot | null>(null);
  const [appointmentForm, setAppointmentForm] = useState<AppointmentFormState | null>(null);
  const [blockForm, setBlockForm] = useState<BlockFormState | null>(null);
  const [clinicHoursForm, setClinicHoursForm] = useState<ScheduleSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const appointmentDragRef = useRef<AppointmentDragState | null>(null);
  const autoOpenedCourseIdRef = useRef<string | null>(null);
  const [draggingAppointmentId, setDraggingAppointmentId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<AppointmentDragPreview | null>(null);
  const [appointmentMenu, setAppointmentMenu] = useState<AppointmentMenuState | null>(null);

  const weekStart = getWeekStart(anchorDate);
  const weekDates = useMemo(() => WEEKDAY_LABELS.map((_, index) => addDays(weekStart, index)), [weekStart]);
  const weekEnd = weekDates[weekDates.length - 1] ?? weekStart;
  const settings = snapshot?.settings ?? { clinicStartTime: "08:00", clinicEndTime: "17:00" };
  const clinicHours = clinicHoursForm ?? settings;
  const slots = useMemo(() => buildSlots(settings.clinicStartTime, settings.clinicEndTime), [settings]);

  async function loadSchedule() {
    if (!props.appClient) return;
    const loaded = await props.appClient.getScheduleSnapshot(weekStart, weekEnd);
    setSnapshot(loaded);
    if (props.initialCourseId && autoOpenedCourseIdRef.current !== props.initialCourseId) {
      const course = loaded.activeCourses.find((item) => item.courseId === props.initialCourseId);
      if (course) {
        autoOpenedCourseIdRef.current = props.initialCourseId;
        setAppointmentForm((current) => current ?? buildLinkedForm(course, anchorDate, settings.clinicStartTime, true));
      }
    }
  }

  useEffect(() => {
    void loadSchedule();
  }, [weekStart, weekEnd, props.initialCourseId]);

  useEffect(() => {
    if (!appointmentMenu) {
      return;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAppointmentMenu(null);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [appointmentMenu]);

  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, ScheduleAppointmentRecord[]>();
    for (const appointment of snapshot?.appointments ?? []) {
      const list = map.get(appointment.appointmentDate) ?? [];
      list.push(appointment);
      map.set(appointment.appointmentDate, list);
    }
    return map;
  }, [snapshot]);

  const firstOpenTime = slots[0] ?? "08:00";

  function getConflict(input: ScheduleAppointmentInput, ignoreId?: string) {
    const doubleBookingConflict = getDoubleBookingConflict(snapshot?.appointments ?? [], input, ignoreId);
    if (doubleBookingConflict) {
      return doubleBookingConflict;
    }

    const blockConflict = (snapshot?.blocks ?? []).find((block) => {
      if (!recurringBlockApplies(block, input.appointmentDate)) return false;
      return hasTimeOverlap(block.startTime, block.endTime, input.startTime, input.endTime);
    });
    if (blockConflict) {
      return blockConflict.title;
    }

    return null;
  }

  async function saveAppointmentForm() {
    if (!props.appClient || !appointmentForm) return;
    if (!buildPatientName(appointmentForm.patientFirstName, appointmentForm.patientLastName, appointmentForm.patientName)) {
      window.alert("Enter a patient name before saving.");
      return;
    }
    if (appointmentForm.source === "linked" && !appointmentForm.courseId) {
      window.alert("Choose a course before saving.");
      return;
    }
    const isRecurringTreatment = appointmentForm.appointmentType === "treatment" && appointmentForm.recurring;
    if (isRecurringTreatment && appointmentForm.recurringWeekdays.length === 0) {
      window.alert("Choose at least one recurring day.");
      return;
    }

    setBusy(true);
    try {
      const linkedCourse = snapshot?.activeCourses.find((course) => course.courseId === appointmentForm.courseId) ?? null;
      const total = isRecurringTreatment ? getTreatmentAppointmentCount(appointmentForm, linkedCourse) : 1;
      const linkedFractions = linkedCourse?.prescribedFractions && linkedCourse.prescribedFractions > 0 ? linkedCourse.prescribedFractions : null;
      const existingNumber = Number(appointmentForm.appointmentNumber) || null;
      const existingTotal = Number(appointmentForm.totalAppointments) || null;
      const totalAppointments =
        appointmentForm.appointmentType === "treatment"
          ? appointmentForm.source === "linked"
            ? linkedFractions
            : existingTotal
              ? existingTotal
              : isRecurringTreatment
                ? total
                : null
          : null;
      const startNumber =
        appointmentForm.appointmentType === "sim_consult"
          ? 0
          : appointmentForm.appointmentType === "treatment"
            ? existingNumber ?? linkedCourse?.suggestedTreatmentNumber ?? (isRecurringTreatment ? 1 : null)
            : null;
      const seriesId = appointmentForm.id ? appointmentForm.seriesId : isRecurringTreatment ? createSeriesId() : appointmentForm.seriesId;
      const inputs: ScheduleAppointmentInput[] = [];

      if (isRecurringTreatment && !appointmentForm.id) {
        let dateCursor = appointmentForm.appointmentDate;
        let attempts = 0;
        while (inputs.length < total && attempts < 520) {
          attempts += 1;
          const weekday = parseIsoDate(dateCursor).getDay();
          if (appointmentForm.recurringWeekdays.includes(weekday)) {
            const holidayName = getUsHolidayName(dateCursor);
            if (!holidayName || !window.confirm(`${holidayName} falls on ${formatDayHeader(dateCursor)}. Do you wish to skip this holiday?`)) {
              const appointmentNumber =
                appointmentForm.appointmentType === "treatment" && startNumber
                  ? startNumber + inputs.length
                  : null;
              const input = buildAppointmentInput(appointmentForm, dateCursor, appointmentNumber, totalAppointments, seriesId);
              const conflict = getConflict(input);
              if (conflict) {
                window.alert(`This appointment overlaps with ${conflict}. Please choose another time.`);
                return;
              }
              inputs.push(input);
            }
          }
          dateCursor = addDays(dateCursor, 1);
        }
      } else {
        const input = buildAppointmentInput(appointmentForm, appointmentForm.appointmentDate, startNumber, totalAppointments, seriesId);
        const conflict = getConflict(input, appointmentForm.id);
        if (conflict) {
          window.alert(`This appointment overlaps with ${conflict}. Please choose another time.`);
          return;
        }
        inputs.push(input);
      }

      const saved = [];
      for (const input of inputs) {
        saved.push(await props.appClient.saveScheduleAppointment(input));
      }

      if (appointmentForm.id && appointmentForm.moveFollowing && appointmentForm.seriesId && appointmentForm.originalDate && appointmentForm.originalStartTime) {
        const dayDelta =
          (parseIsoDate(appointmentForm.appointmentDate).getTime() - parseIsoDate(appointmentForm.originalDate).getTime()) / 86_400_000;
        const timeDelta = timeToMinutes(appointmentForm.startTime) - timeToMinutes(appointmentForm.originalStartTime);
        const affected = (snapshot?.appointments ?? []).filter(
          (appointment) =>
            appointment.seriesId === appointmentForm.seriesId &&
            appointment.id !== appointmentForm.id &&
            appointment.appointmentDate >= appointmentForm.originalDate!
        );
        for (const appointment of affected) {
          await props.appClient.saveScheduleAppointment({
            ...appointment,
            appointmentDate: addDays(appointment.appointmentDate, dayDelta),
            startTime: minutesToTime(timeToMinutes(appointment.startTime) + timeDelta),
            endTime: minutesToTime(timeToMinutes(appointment.endTime) + timeDelta)
          });
        }
      }

      setAppointmentForm(null);
      await loadSchedule();
      props.onNotify(saved.length > 1 ? `${saved.length} appointments scheduled.` : "Appointment saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBlockForm() {
    if (!props.appClient || !blockForm) return;
    if (!blockForm.title.trim()) {
      await closeClinicHoursModal();
      return;
    }
    if (blockForm.isRecurring && blockForm.recurringWeekdays.length === 0) {
      window.alert("Choose at least one recurring day.");
      return;
    }

    setBusy(true);
    try {
      if (clinicHoursForm) {
        await saveSettings(clinicHoursForm);
      }
      await props.appClient.saveScheduleBlock(getBlockInput(blockForm));
      setBlockForm(null);
      setClinicHoursForm(null);
      await loadSchedule();
      props.onNotify("Schedule block saved.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(appointment: ScheduleAppointmentRecord, status: ScheduleAppointmentStatus) {
    if (!props.appClient) return;
    await props.appClient.updateScheduleAppointmentStatus(appointment.id, status);
    await loadSchedule();
  }

  async function deleteAppointment() {
    if (!props.appClient || !appointmentForm?.id) return;
    if (!window.confirm("Delete this appointment?")) return;
    await props.appClient.deleteScheduleAppointment(appointmentForm.id);
    setAppointmentForm(null);
    await loadSchedule();
    props.onNotify("Appointment deleted.");
  }

  async function deleteBlock() {
    if (!props.appClient || !blockForm?.id) return;
    if (!window.confirm("Delete this closed time?")) return;
    await props.appClient.deleteScheduleBlock(blockForm.id);
    setBlockForm(null);
    setClinicHoursForm(null);
    await loadSchedule();
    props.onNotify("Closed time deleted.");
  }

  function openClinicHours(form: BlockFormState) {
    setClinicHoursForm({ ...settings });
    setBlockForm(form);
  }

  async function closeClinicHoursModal() {
    if (!props.appClient) {
      setBlockForm(null);
      setClinicHoursForm(null);
      return;
    }

    setBusy(true);
    try {
      if (clinicHoursForm) {
        await saveSettings(clinicHoursForm);
      }
      setBlockForm(null);
      setClinicHoursForm(null);
    } finally {
      setBusy(false);
    }
  }

  function getAppointmentDropTarget(clientX: number, clientY: number, appointmentTopY: number, durationMinutes: number) {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const column = target?.closest<HTMLElement>(".schedule-day-column");
    const appointmentDate = column?.dataset.date;
    if (!column || !appointmentDate) {
      return null;
    }

    const columnRect = column.getBoundingClientRect();
    const rowHeight = 32;
    const headerHeight = 44;
    const cardMargin = 2;
    const rawIndex = Math.round((appointmentTopY - columnRect.top - headerHeight - cardMargin) / rowHeight);
    const slotIndex = clamp(rawIndex, 0, Math.max(0, slots.length - 1));
    const startTime = slots[slotIndex] ?? settings.clinicStartTime;
    return {
      appointmentDate,
      startTime,
      endTime: getAppointmentEndTime(startTime, durationMinutes)
    };
  }

  function setNextDragPreview(nextPreview: AppointmentDragPreview | null) {
    setDragPreview((current) => {
      if (!current && !nextPreview) {
        return current;
      }
      if (
        current &&
        nextPreview &&
        current.appointment.id === nextPreview.appointment.id &&
        current.appointmentDate === nextPreview.appointmentDate &&
        current.startTime === nextPreview.startTime &&
        current.endTime === nextPreview.endTime &&
        current.hasConflict === nextPreview.hasConflict
      ) {
        return current;
      }
      return nextPreview;
    });
  }

  function getDragPreviewForPointer(drag: AppointmentDragState, clientX: number, clientY: number) {
    const duration = getDuration(drag.appointment.startTime, drag.appointment.endTime);
    const dropTarget = getAppointmentDropTarget(clientX, clientY, clientY - drag.offsetY, duration);
    if (!dropTarget) {
      return null;
    }

    const movedAppointment = {
      ...drag.appointment,
      appointmentDate: dropTarget.appointmentDate,
      startTime: dropTarget.startTime,
      endTime: dropTarget.endTime
    };
    return {
      appointment: drag.appointment,
      appointmentDate: dropTarget.appointmentDate,
      startTime: dropTarget.startTime,
      endTime: dropTarget.endTime,
      hasConflict: Boolean(getConflict(movedAppointment, drag.appointment.id))
    };
  }

  function beginAppointmentPointer(event: ReactPointerEvent<HTMLButtonElement>, appointment: ScheduleAppointmentRecord) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    setAppointmentMenu(null);
    const rect = event.currentTarget.getBoundingClientRect();
    appointmentDragRef.current = {
      appointment,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetY: event.clientY - rect.top,
      moved: false
    };
    setDraggingAppointmentId(appointment.id);
    setNextDragPreview(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateAppointmentPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = appointmentDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
      drag.moved = true;
    }
    if (drag.moved) {
      event.preventDefault();
      setNextDragPreview(getDragPreviewForPointer(drag, event.clientX, event.clientY));
    }
  }

  async function endAppointmentPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = appointmentDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    appointmentDragRef.current = null;
    setDraggingAppointmentId(null);
    setNextDragPreview(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released after touch cancellation.
    }

    if (!drag.moved) {
      setAppointmentMenu({
        appointment: drag.appointment,
        x: event.clientX,
        y: event.clientY,
        showStatusMenu: false
      });
      return;
    }

    if (!props.appClient) {
      return;
    }

    const duration = getDuration(drag.appointment.startTime, drag.appointment.endTime);
    const dropTarget = getAppointmentDropTarget(event.clientX, event.clientY, event.clientY - drag.offsetY, duration);
    if (!dropTarget) {
      return;
    }

    if (
      dropTarget.appointmentDate === drag.appointment.appointmentDate &&
      dropTarget.startTime === drag.appointment.startTime
    ) {
      return;
    }

    const movedAppointment = {
      ...drag.appointment,
      appointmentDate: dropTarget.appointmentDate,
      startTime: dropTarget.startTime,
      endTime: dropTarget.endTime
    };
    const conflict = getConflict(movedAppointment, drag.appointment.id);
    if (conflict) {
      window.alert(`This appointment overlaps with ${conflict}. Please choose another time.`);
      return;
    }

    await props.appClient.saveScheduleAppointment(movedAppointment);
    await loadSchedule();
    props.onNotify("Appointment moved.");
  }

  function cancelAppointmentPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = appointmentDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      appointmentDragRef.current = null;
      setDraggingAppointmentId(null);
      setNextDragPreview(null);
    }
  }

  function findExistingPatientForIntake(dashboard: DashboardSnapshot, form: AppointmentFormState) {
    const rows = [
      ...dashboard.activeCourses,
      ...dashboard.pendingCourses,
      ...dashboard.patientsWithoutCourse
    ];
    const mrn = normalizeMatchValue(form.patientMrn);
    const dob = form.patientDob;
    const patientName = normalizeMatchValue(buildPatientName(form.patientFirstName, form.patientLastName, form.patientName));
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.patientId)) {
        continue;
      }
      seen.add(row.patientId);
      if (mrn && normalizeMatchValue(row.patientMrn) === mrn) {
        return row;
      }
      if (dob && row.patientDob === dob && normalizeMatchValue(row.patientName) === patientName) {
        return row;
      }
    }
    return null;
  }

  function buildPatientInputFromIntake(form: AppointmentFormState): PatientInput {
    return {
      firstName: form.patientFirstName.trim(),
      lastName: form.patientLastName.trim(),
      mrn: form.patientMrn.trim(),
      dob: form.patientDob,
      sex: form.patientSex,
      notes: ""
    };
  }

  function buildCourseInputFromIntake(patientId: string, form: AppointmentFormState): CourseInput {
    const sites = form.intakeSites.map(toCourseSiteInput);
    const prescribedFractions = Math.max(0, ...form.intakeSites.map((site) => site.projectedFractions ?? 0));
    return {
      patientId,
      courseName: buildCourseNameFromIntakeSites(form.intakeSites),
      courseType: form.intakeCourseType,
      prescribedFractions,
      startDate: form.intakeBiopsyDate || form.appointmentDate,
      simConsultDate: form.appointmentDate,
      status: "pending",
      sites
    };
  }

  async function createActivePatientFromSchedule() {
    if (!props.appClient || !appointmentForm || appointmentForm.appointmentType !== "sim_consult") {
      return;
    }
    if (!appointmentForm.patientFirstName.trim() || !appointmentForm.patientLastName.trim()) {
      window.alert("Enter the patient's first and last name before creating the active patient.");
      return;
    }
    if (!appointmentForm.intakeSites.some((site) => site.treatmentLocationText.trim())) {
      window.alert("Enter at least one treatment lesion before creating the active patient.");
      return;
    }

    setBusy(true);
    try {
      const dashboard = await props.appClient.getDashboardSnapshot();
      const existingPatient = findExistingPatientForIntake(dashboard, appointmentForm);
      const patient = existingPatient
        ? { id: existingPatient.patientId }
        : await props.appClient.savePatient(buildPatientInputFromIntake(appointmentForm));
      const course = await props.appClient.saveCourse(buildCourseInputFromIntake(patient.id, appointmentForm));
      const linkedForm = {
        ...appointmentForm,
        id: appointmentForm.id,
        source: "linked" as const,
        patientId: patient.id,
        courseId: course.id,
        patientName: buildPatientName(appointmentForm.patientFirstName, appointmentForm.patientLastName, appointmentForm.patientName)
      };
      await props.appClient.saveScheduleAppointment(buildAppointmentInput(linkedForm, appointmentForm.appointmentDate, 0, null, appointmentForm.seriesId));
      setAppointmentForm(null);
      await loadSchedule();
      props.onNotify(existingPatient ? "Scheduled consult linked to existing active patient." : "Scheduled consult imported to Active Patients.");
      props.onOpenPatient(patient.id);
    } finally {
      setBusy(false);
    }
  }

  async function importScheduledConsultAppointment(appointment: ScheduleAppointmentRecord) {
    if (!props.appClient || appointment.appointmentType !== "sim_consult") {
      return null;
    }

    const form = appointmentToForm(appointment);
    if (!form.patientFirstName.trim() || !form.patientLastName.trim()) {
      window.alert("Enter the patient's first and last name before creating the active patient.");
      return null;
    }
    if (!form.intakeSites.some((site) => site.treatmentLocationText.trim())) {
      window.alert("Enter at least one treatment lesion before creating the active patient.");
      return null;
    }

    setBusy(true);
    try {
      const dashboard = await props.appClient.getDashboardSnapshot();
      const existingPatient = findExistingPatientForIntake(dashboard, form);
      const patient = existingPatient
        ? { id: existingPatient.patientId }
        : await props.appClient.savePatient(buildPatientInputFromIntake(form));
      const course = await props.appClient.saveCourse(buildCourseInputFromIntake(patient.id, form));
      const linkedForm = {
        ...form,
        id: form.id,
        source: "linked" as const,
        patientId: patient.id,
        courseId: course.id,
        patientName: buildPatientName(form.patientFirstName, form.patientLastName, form.patientName)
      };
      const savedAppointment = await props.appClient.saveScheduleAppointment(
        buildAppointmentInput(linkedForm, form.appointmentDate, 0, null, form.seriesId)
      );
      await loadSchedule();
      props.onNotify(existingPatient ? "Scheduled consult linked to existing active patient." : "Scheduled consult imported to Active Patients.");
      return savedAppointment;
    } finally {
      setBusy(false);
    }
  }

  async function startAppointmentFromMenu(appointment: ScheduleAppointmentRecord) {
    setAppointmentMenu(null);
    if (!props.appClient) {
      return;
    }

    if (!appointment.courseId) {
      if (appointment.appointmentType !== "sim_consult") {
        window.alert("Link this appointment to an active course before starting a note.");
        return;
      }
      const linkedAppointment = await importScheduledConsultAppointment(appointment);
      if (linkedAppointment) {
        props.onStartAppointmentNote(linkedAppointment);
      }
      return;
    }

    props.onStartAppointmentNote(appointment);
  }

  async function saveSettings(nextSettings: ScheduleSettingsView) {
    if (!props.appClient) return;
    const saved = await props.appClient.saveScheduleSettings(nextSettings);
    setSnapshot((current) => (current ? { ...current, settings: saved } : current));
  }

  function chooseCourse(courseId: string) {
    const course = snapshot?.activeCourses.find((item) => item.courseId === courseId);
    if (!course) {
      setAppointmentForm((current) => (current ? { ...current, courseId, source: "manual" } : current));
      return;
    }
    setAppointmentForm((current) => {
      const appointmentType = current?.appointmentType ?? (course.suggestedNoteType === "consult_sim" ? "sim_consult" : "treatment");
      const isTreatment = appointmentType === "treatment";
      const patientName = splitStoredPatientName(course.patientName);
      return {
        ...(current ?? buildLinkedForm(course, anchorDate, firstOpenTime)),
        source: "linked",
        courseId: course.courseId,
        patientId: course.patientId,
        patientName: course.patientName,
        patientFirstName: patientName.firstName,
        patientLastName: patientName.lastName,
        patientMrn: course.patientMrn,
        patientDob: course.patientDob,
        durationMinutes: getCourseDuration(course),
        appointmentType,
        appointmentNumber: current?.appointmentNumber || `${appointmentType === "sim_consult" ? 0 : isTreatment ? course.suggestedTreatmentNumber ?? 1 : ""}`,
        totalAppointments: isTreatment && course.prescribedFractions ? `${course.prescribedFractions}` : "",
        recurring: isTreatment ? current?.recurring ?? course.suggestedNoteType !== "consult_sim" : false,
        recurringCount:
          isTreatment
            ? current?.recurringCount ||
              `${Math.max(1, course.prescribedFractions - (course.suggestedTreatmentNumber ?? 1) + 1)}`
            : "1"
      };
    });
  }

  function updateIntakeSite(index: number, patch: Partial<ScheduleIntakeSiteInput>) {
    setAppointmentForm((current) =>
      current
        ? {
            ...current,
            intakeSites: current.intakeSites.map((site, siteIndex) =>
              siteIndex === index
                ? {
                    ...site,
                    ...patch
                  }
                : site
            )
          }
        : current
    );
  }

  return (
    <section className="stack schedule-screen">
      <div className="section-header">
        <div>
          <h2>Schedule</h2>
          <p>Weekly treatment schedule, standalone visits, closures, and patient calendars.</p>
        </div>
        <div className="button-row">
          <button onClick={() => openClinicHours({ title: "", blockDate: anchorDate, startTime: firstOpenTime, endTime: getAppointmentEndTime(firstOpenTime, 60), blockType: "closed", isRecurring: false, recurringWeekdays: [] })}>
            Clinic Hours
          </button>
          <button className="primary" onClick={() => setAppointmentForm(buildDefaultAppointmentForm(anchorDate, firstOpenTime))}>
            Add Appointment
          </button>
        </div>
      </div>

      <div className="panel schedule-toolbar">
        <button onClick={() => setAnchorDate(addDays(anchorDate, -7))}>Previous Week</button>
        <div className="field compact-field">
          <label>Week Of</label>
          <div className="week-range-display">{formatFullDate(weekStart)} - {formatFullDate(weekEnd)}</div>
          <CalendarDateInput value={anchorDate} onChange={setAnchorDate} />
        </div>
        <button onClick={() => setAnchorDate(todayIso())}>Current Week</button>
        <button onClick={() => setAnchorDate(addDays(anchorDate, 7))}>Next Week</button>
      </div>

      {snapshot ? (
        <div className="schedule-board-wrapper">
          <div className="schedule-week-board">
            <div
              className="schedule-time-rail"
              style={{ gridTemplateRows: `44px repeat(${slots.length}, 32px)` }}
            >
              <div className="schedule-day-header">Time</div>
              {slots.map((slot) => (
                <div
                  className={`schedule-time-label${isQuarterHour(slot) ? " schedule-time-label-quarter" : ""}${isHour(slot) ? " schedule-time-label-hour" : ""}`}
                  key={slot}
                >
                  {isQuarterHour(slot) ? formatTime(slot) : ""}
                </div>
              ))}
            </div>
            {weekDates.map((dateIso) => {
              const holidayName = getUsHolidayName(dateIso);
              const dayAppointments = appointmentsByDate.get(dateIso) ?? [];
              const appointmentLaneMap = buildAppointmentLaneMap(dayAppointments);
              const dayBlocks = (snapshot.blocks ?? []).filter((block) => recurringBlockApplies(block, dateIso));
              const dayDragPreview = dragPreview?.appointmentDate === dateIso ? dragPreview : null;
              return (
                <div
                  className="schedule-day-column"
                  key={dateIso}
                  data-date={dateIso}
                  style={{ gridTemplateRows: `44px repeat(${slots.length}, 32px)` }}
                >
                  <div className={holidayName ? "schedule-day-header schedule-day-holiday" : "schedule-day-header"}>
                    <strong>{formatDayHeader(dateIso)}</strong>
                    {holidayName ? <span>{holidayName}</span> : null}
                  </div>
                  {slots.map((slot, index) => (
                    <button
                      type="button"
                      className={`schedule-slot${isQuarterHour(slot) ? " schedule-slot-quarter" : ""}${isHour(slot) ? " schedule-slot-hour" : ""}`}
                      key={`${dateIso}-${slot}`}
                      style={{ gridRow: index + 2 }}
                      onClick={() => {
                        setAppointmentMenu(null);
                        setAppointmentForm(buildDefaultAppointmentForm(dateIso, slot));
                      }}
                    />
                  ))}
                  {dayBlocks.map((block) => {
                    const rowIndex = getRowIndex(block.startTime, settings.clinicStartTime);
                    const span = Math.max(1, Math.round(getDuration(block.startTime, block.endTime) / 5));
                    const gridStart = rowIndex + 2;
                    return (
                      <button
                        type="button"
                        className={`schedule-block schedule-block-${block.blockType}`}
                        key={block.id}
                        style={{ gridRow: `${gridStart} / ${gridStart + span}` }}
                        onClick={() => {
                          setAppointmentMenu(null);
                          openClinicHours(blockToForm(block));
                        }}
                      >
                        <span>{block.title}</span>
                      </button>
                    );
                  })}
                  {dayAppointments.map((appointment) => {
                    const rowIndex = getRowIndex(appointment.startTime, settings.clinicStartTime);
                    const span = Math.max(3, Math.round(getDuration(appointment.startTime, appointment.endTime) / 5));
                    const gridStart = rowIndex + 2;
                    const siteLabel = getAppointmentSiteLabel(appointment);
                    return (
                      <button
                        type="button"
                        className={`schedule-appointment schedule-status-${appointment.status}${draggingAppointmentId === appointment.id ? " is-dragging" : ""}`}
                        key={appointment.id}
                        style={{
                          gridRow: `${gridStart} / ${gridStart + span}`,
                          ...getAppointmentLaneStyle(appointmentLaneMap.get(appointment.id))
                        }}
                        onPointerDown={(event) => beginAppointmentPointer(event, appointment)}
                        onPointerMove={updateAppointmentPointer}
                        onPointerUp={(event) => void endAppointmentPointer(event)}
                        onPointerCancel={cancelAppointmentPointer}
                      >
                        <strong className="schedule-appointment-time">{formatScheduleTimeRange(appointment.startTime, appointment.endTime)}</strong>
                        <span>{appointment.patientName}</span>
                        {siteLabel ? <small className="schedule-appointment-site">{siteLabel}</small> : null}
                        <small>{getAppointmentShortLabel(appointment)} - {getStatusLabel(appointment.status)}</small>
                      </button>
                    );
                  })}
                  {dayDragPreview
                    ? (() => {
                        const rowIndex = getRowIndex(dayDragPreview.startTime, settings.clinicStartTime);
                        const span = Math.max(
                          3,
                          Math.round(getDuration(dayDragPreview.startTime, dayDragPreview.endTime) / 5)
                        );
                        const gridStart = rowIndex + 2;
                        const siteLabel = getAppointmentSiteLabel(dayDragPreview.appointment);
                        return (
                          <div
                            className={`schedule-drop-preview${dayDragPreview.hasConflict ? " has-conflict" : ""}`}
                            style={{ gridRow: `${gridStart} / ${gridStart + span}` }}
                          >
                            <strong className="schedule-appointment-time">
                              {formatScheduleTimeRange(dayDragPreview.startTime, dayDragPreview.endTime)}
                            </strong>
                            <span>{dayDragPreview.appointment.patientName}</span>
                            {siteLabel ? <small className="schedule-appointment-site">{siteLabel}</small> : null}
                            <small>
                              {getAppointmentShortLabel(dayDragPreview.appointment)} -{" "}
                              {getStatusLabel(dayDragPreview.appointment.status)}
                            </small>
                          </div>
                        );
                      })()
                    : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel">Loading schedule...</div>
      )}

      {appointmentMenu ? (
        <div className="appointment-action-layer" onPointerDown={() => setAppointmentMenu(null)}>
          <div
            className="appointment-action-menu"
            style={getAppointmentMenuPosition(appointmentMenu.x, appointmentMenu.y)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => void startAppointmentFromMenu(appointmentMenu.appointment)}>
              Start Today's Note
            </button>
            <div className="appointment-status-menu-wrap">
              <button
                type="button"
                className="appointment-status-trigger"
                onClick={() =>
                  setAppointmentMenu((current) =>
                    current ? { ...current, showStatusMenu: !current.showStatusMenu } : current
                  )
                }
              >
                <span>Status</span>
                <span>&gt;</span>
              </button>
              {appointmentMenu.showStatusMenu ? (
                <div className="appointment-status-submenu">
                  {STATUS_OPTIONS.map((status) => (
                    <button
                      type="button"
                      key={status.value}
                      className={appointmentMenu.appointment.status === status.value ? "is-selected" : ""}
                      onClick={() => {
                        const targetAppointment = appointmentMenu.appointment;
                        setAppointmentMenu(null);
                        void updateStatus(targetAppointment, status.value);
                      }}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setAppointmentForm(appointmentToForm(appointmentMenu.appointment));
                setAppointmentMenu(null);
              }}
            >
              Edit Appointment
            </button>
          </div>
        </div>
      ) : null}

      {appointmentForm ? (
        <div className="modal-backdrop">
          <div className="modal-card schedule-modal">
            <div className="modal-header">
              <h3>{appointmentForm.id ? "Edit Appointment" : "Add Appointment"}</h3>
              <button onClick={() => setAppointmentForm(null)}>X</button>
            </div>
            <div className="form-grid">
              <label className="field">
                Source
                <select
                  value={appointmentForm.source}
                  onChange={(event) =>
                    setAppointmentForm({
                      ...appointmentForm,
                      source: event.target.value as AppointmentFormState["source"],
                      courseId: "",
                      patientId: null
                    })
                  }
                >
                  <option value="manual">Manual patient</option>
                  <option value="linked">Active course</option>
                </select>
              </label>
              {appointmentForm.source === "linked" ? (
                <label className="field wide">
                  Course
                  <select value={appointmentForm.courseId} onChange={(event) => chooseCourse(event.target.value)}>
                    <option value="">Select course</option>
                    {snapshot?.activeCourses.map((course) => (
                      <option key={course.courseId} value={course.courseId}>
                        {course.patientName} - {course.siteSummary || course.courseName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : appointmentForm.appointmentType === "sim_consult" ? (
                <>
                  <label className="field">
                    First Name
                    <input
                      value={appointmentForm.patientFirstName}
                      onChange={(event) => setAppointmentForm({ ...appointmentForm, patientFirstName: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    Last Name
                    <input
                      value={appointmentForm.patientLastName}
                      onChange={(event) => setAppointmentForm({ ...appointmentForm, patientLastName: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    MRN
                    <input
                      value={appointmentForm.patientMrn}
                      onChange={(event) => setAppointmentForm({ ...appointmentForm, patientMrn: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    DOB
                    <DobInput
                      value={appointmentForm.patientDob}
                      onChange={(value) => setAppointmentForm({ ...appointmentForm, patientDob: value })}
                    />
                  </label>
                  <label className="field">
                    Sex
                    <select
                      value={appointmentForm.patientSex}
                      onChange={(event) => setAppointmentForm({ ...appointmentForm, patientSex: event.target.value })}
                    >
                      <option value="">Select</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>
                </>
              ) : (
                <label className="field wide">
                  Patient Name
                  <input
                    value={appointmentForm.patientName}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, patientName: event.target.value })}
                  />
                </label>
              )}
              <label className="field">
                Appointment Type
                <select
                  value={appointmentForm.appointmentType}
                  onChange={(event) => {
                    const appointmentType = event.target.value as ScheduleAppointmentType;
                    const linkedCourse = snapshot?.activeCourses.find((course) => course.courseId === appointmentForm.courseId) ?? null;
                    const nextStartNumber =
                      appointmentType === "sim_consult"
                        ? "0"
                        : appointmentType === "treatment"
                          ? `${linkedCourse?.suggestedTreatmentNumber ?? 1}`
                          : "";
                    const nextRecurring =
                      appointmentType === "treatment"
                        ? appointmentForm.recurring || Boolean(linkedCourse)
                        : false;
                    const nextRecurringCount =
                      appointmentType === "treatment" && linkedCourse
                        ? `${Math.max(1, linkedCourse.prescribedFractions - (linkedCourse.suggestedTreatmentNumber ?? 1) + 1)}`
                        : appointmentType === "treatment"
                          ? appointmentForm.recurringCount
                          : "1";
                    setAppointmentForm({
                      ...appointmentForm,
                      appointmentType,
                      appointmentNumber: nextStartNumber,
                      totalAppointments: appointmentType === "treatment" && linkedCourse?.prescribedFractions ? `${linkedCourse.prescribedFractions}` : "",
                      recurring: nextRecurring,
                      recurringCount: nextRecurringCount,
                      recurringWeekdays: appointmentType === "treatment" ? appointmentForm.recurringWeekdays : []
                    });
                  }}
                >
                  <option value="treatment">Treatment</option>
                  <option value="sim_consult">Sim/Consult</option>
                  <option value="follow_up">Follow-up</option>
                </select>
              </label>
              <label className="field">
                Date
                <CalendarDateInput
                  value={appointmentForm.appointmentDate}
                  onChange={(value) => setAppointmentForm({ ...appointmentForm, appointmentDate: value })}
                />
              </label>
              <label className="field">
                Time
                <input
                  type="time"
                  step="300"
                  value={appointmentForm.startTime}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, startTime: event.target.value })}
                />
              </label>
              <label className="field">
                Window
                <select
                  value={appointmentForm.durationMinutes}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, durationMinutes: Number(event.target.value) })}
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </label>
              <label className="field">
                Status
                <select
                  value={appointmentForm.status}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, status: event.target.value as ScheduleAppointmentStatus })}
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="missed">Missed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="rescheduled">Rescheduled</option>
                </select>
              </label>
            </div>

            {appointmentForm.appointmentType === "sim_consult" ? (
              <div className="panel schedule-subpanel">
                <div className="form-grid course-top-grid">
                  <label className="field">
                    Number of Lesions
                    <select
                      value={appointmentForm.intakeCourseType}
                      onChange={(event) => {
                        const nextType = event.target.value as AppointmentFormState["intakeCourseType"];
                        const nextSites =
                          nextType === "two_site"
                            ? [
                                createEmptyIntakeSite(1, appointmentForm.intakeSites[0]),
                                createEmptyIntakeSite(2, appointmentForm.intakeSites[1])
                              ]
                            : [createEmptyIntakeSite(1, appointmentForm.intakeSites[0])];
                        setAppointmentForm({ ...appointmentForm, intakeCourseType: nextType, intakeSites: nextSites });
                      }}
                    >
                      <option value="one_site">1 Lesion</option>
                      <option value="two_site">2 Lesions</option>
                    </select>
                  </label>
                  <label className="field">
                    Biopsy Date
                    <CalendarDateInput
                      value={appointmentForm.intakeBiopsyDate}
                      onChange={(value) => setAppointmentForm({ ...appointmentForm, intakeBiopsyDate: value })}
                    />
                  </label>
                </div>
                <div className={appointmentForm.intakeCourseType === "two_site" ? "site-grid two-site-course-grid" : "site-grid"}>
                  {appointmentForm.intakeSites.map((site, index) => {
                    const fractionSelection =
                      site.projectedFractions == null
                        ? ""
                        : FRACTION_PRESETS.includes(site.projectedFractions)
                          ? String(site.projectedFractions)
                          : "other";
                    return (
                      <div className="subpanel" key={site.siteNumber}>
                        <h4>{appointmentForm.intakeCourseType === "two_site" ? `Lesion ${site.siteNumber}` : "Lesion"}</h4>
                        <div className="form-grid course-top-grid">
                          <label>
                            Treatment Lesion
                            <input
                              placeholder="Treatment location"
                              value={site.treatmentLocationText}
                              onChange={(event) => updateIntakeSite(index, { treatmentLocationText: event.target.value })}
                            />
                          </label>
                          <label>
                            Diagnosis
                            <select
                              value={site.diagnosisText}
                              onChange={(event) => updateIntakeSite(index, { diagnosisText: event.target.value })}
                            >
                              <option value="">Select Diagnosis</option>
                              {DIAGNOSIS_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            ICD10
                            <input
                              placeholder="ICD10"
                              value={site.icd10}
                              onChange={(event) => updateIntakeSite(index, { icd10: event.target.value.toUpperCase() })}
                            />
                          </label>
                          <label>
                            {appointmentForm.intakeCourseType === "two_site" ? `Projected Fractions Lesion ${site.siteNumber}` : "Projected Fractions"}
                            <select
                              value={fractionSelection}
                              onChange={(event) =>
                                updateIntakeSite(index, {
                                  projectedFractions: event.target.value === "other"
                                    ? site.projectedFractions ?? 0
                                    : event.target.value
                                      ? Number(event.target.value)
                                      : null
                                })
                              }
                            >
                              <option value="">Select Fractions</option>
                              {FRACTION_PRESETS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                              <option value="other">Other</option>
                            </select>
                          </label>
                          {fractionSelection === "other" ? (
                            <label>
                              Actual Projected Fractions
                              <NumericInput
                                placeholder="Enter fractions"
                                value={site.projectedFractions ?? ""}
                                onChange={(value) => updateIntakeSite(index, { projectedFractions: value ? Number(value) : null })}
                              />
                            </label>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {appointmentForm.id && !appointmentForm.patientId ? (
                  <div className="button-row">
                    <button className="primary" disabled={busy} onClick={() => void createActivePatientFromSchedule()}>
                      Create Active Patient
                    </button>
                  </div>
                ) : appointmentForm.patientId ? (
                  <p className="muted" style={{ marginBottom: 0 }}>This scheduled consult is linked to Active Patients.</p>
                ) : null}
              </div>
            ) : null}

            {!appointmentForm.id && appointmentForm.appointmentType === "treatment" ? (
              <div className="panel schedule-subpanel">
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={appointmentForm.recurring}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, recurring: event.target.checked })}
                  />
                  Recurring treatment appointments
                </label>
                {appointmentForm.recurring ? (
                  <>
                    <p className="muted" style={{ margin: 0 }}>
                      {getTreatmentAppointmentCount(
                        appointmentForm,
                        snapshot?.activeCourses.find((course) => course.courseId === appointmentForm.courseId) ?? null
                      )} treatment appointments will be created from the projected fractions.
                    </p>
                    <div className="weekday-picker">
                      {WEEKDAY_OPTIONS.map((day) => (
                        <label key={day.value} className="checkbox-pill">
                          <input
                            type="checkbox"
                            checked={appointmentForm.recurringWeekdays.includes(day.value)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...appointmentForm.recurringWeekdays, day.value]
                                : appointmentForm.recurringWeekdays.filter((item) => item !== day.value);
                              setAppointmentForm({ ...appointmentForm, recurringWeekdays: next.sort() });
                            }}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : appointmentForm.seriesId ? (
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={appointmentForm.moveFollowing}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, moveFollowing: event.target.checked })}
                />
                Move following appointments in this schedule too
              </label>
            ) : null}

            <div className="button-row modal-actions">
              {appointmentForm.id ? (
                <>
                  <button onClick={() => void updateStatus(snapshot!.appointments.find((item) => item.id === appointmentForm.id)!, "completed")}>
                    Mark Complete
                  </button>
                  <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => void deleteAppointment()}>
                    Delete
                  </button>
                </>
              ) : null}
              <button onClick={() => setAppointmentForm(null)}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => void saveAppointmentForm()}>
                Save Appointment
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {blockForm ? (
        <div className="modal-backdrop">
          <div className="modal-card schedule-modal">
            <div className="modal-header">
              <h3>Clinic Hours</h3>
              <button onClick={() => void closeClinicHoursModal()}>X</button>
            </div>
            <div className="panel schedule-subpanel clinic-hours-settings">
              <h4>Regular Clinic Hours</h4>
              <div className="clinic-hours-inputs">
                <label className="field">
                  Opens
                  <input
                    aria-label="Clinic opens"
                    type="time"
                    step="300"
                    value={clinicHours.clinicStartTime}
                    onChange={(event) => setClinicHoursForm({ ...clinicHours, clinicStartTime: event.target.value })}
                  />
                </label>
                <span>to</span>
                <label className="field">
                  Closes
                  <input
                    aria-label="Clinic closes"
                    type="time"
                    step="300"
                    value={clinicHours.clinicEndTime}
                    onChange={(event) => setClinicHoursForm({ ...clinicHours, clinicEndTime: event.target.value })}
                  />
                </label>
              </div>
            </div>
            <div className="panel schedule-subpanel">
              <h4>{blockForm.id ? "Edit Closed Time" : "Add Closed Time"}</h4>
            <div className="form-grid">
              <label className="field wide">
                Title
                <input value={blockForm.title} onChange={(event) => setBlockForm({ ...blockForm, title: event.target.value })} />
              </label>
              <label className="field">
                Type
                <select
                  value={blockForm.blockType}
                  onChange={(event) => setBlockForm({ ...blockForm, blockType: event.target.value as ScheduleBlockType })}
                >
                  <option value="closed">Closed Office</option>
                  <option value="holiday">Holiday</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label className="field">
                Date
                <CalendarDateInput value={blockForm.blockDate} onChange={(value) => setBlockForm({ ...blockForm, blockDate: value })} />
              </label>
              <label className="field">
                Start
                <input type="time" step="300" value={blockForm.startTime} onChange={(event) => setBlockForm({ ...blockForm, startTime: event.target.value })} />
              </label>
              <label className="field">
                End
                <input type="time" step="300" value={blockForm.endTime} onChange={(event) => setBlockForm({ ...blockForm, endTime: event.target.value })} />
              </label>
            </div>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={blockForm.isRecurring}
                onChange={(event) => setBlockForm({ ...blockForm, isRecurring: event.target.checked })}
              />
              Repeat weekly as permanent closed time
            </label>
            {blockForm.isRecurring ? (
              <div className="weekday-picker">
                {WEEKDAY_OPTIONS.map((day) => (
                  <label key={day.value} className="checkbox-pill">
                    <input
                      type="checkbox"
                      checked={blockForm.recurringWeekdays.includes(day.value)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...blockForm.recurringWeekdays, day.value]
                          : blockForm.recurringWeekdays.filter((item) => item !== day.value);
                        setBlockForm({ ...blockForm, recurringWeekdays: next.sort() });
                      }}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            ) : null}
            </div>
            <div className="button-row modal-actions">
              {blockForm.id ? (
                <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => void deleteBlock()}>
                  Delete
                </button>
              ) : null}
              {blockForm.id || blockForm.title.trim() ? (
                <button onClick={() => void closeClinicHoursModal()}>Done</button>
              ) : null}
              <button
                className="primary"
                disabled={busy}
                onClick={() => void (blockForm.id || blockForm.title.trim() ? saveBlockForm() : closeClinicHoursModal())}
              >
                {blockForm.id || blockForm.title.trim() ? "Save Closed Time" : "Done"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
