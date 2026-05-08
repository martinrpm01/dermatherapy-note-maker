import { contextBridge, ipcRenderer } from "electron";

import type { ElectronApi } from "../shared/types";

const api: ElectronApi = {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  reportReady: (screen) => ipcRenderer.invoke("app:reportReady", screen),
  unlock: (pin) => ipcRenderer.invoke("app:unlock", pin),
  lock: () => ipcRenderer.invoke("app:lock"),
  setInitialPin: (pin) => ipcRenderer.invoke("app:setInitialPin", pin),
  changePin: (currentPin, nextPin) => ipcRenderer.invoke("app:changePin", currentPin, nextPin),
  resetPinWithRecoveryCode: (recoveryCode, nextPin) =>
    ipcRenderer.invoke("app:resetPinWithRecoveryCode", recoveryCode, nextPin),
  wipeAllLocalData: () => ipcRenderer.invoke("app:wipeAllLocalData"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  openUpdateDownload: () => ipcRenderer.invoke("app:openUpdateDownload"),

  getDashboardSnapshot: () => ipcRenderer.invoke("dashboard:getSnapshot"),
  getScheduleSnapshot: (startDate, endDate) => ipcRenderer.invoke("schedule:getSnapshot", startDate, endDate),
  saveScheduleAppointment: (input) => ipcRenderer.invoke("schedule:saveAppointment", input),
  deleteScheduleAppointment: (appointmentId) => ipcRenderer.invoke("schedule:deleteAppointment", appointmentId),
  deleteCourseTreatmentSchedule: (courseId) => ipcRenderer.invoke("schedule:deleteCourseTreatments", courseId),
  updateScheduleAppointmentStatus: (appointmentId, status) =>
    ipcRenderer.invoke("schedule:updateAppointmentStatus", appointmentId, status),
  saveScheduleBlock: (input) => ipcRenderer.invoke("schedule:saveBlock", input),
  deleteScheduleBlock: (blockId) => ipcRenderer.invoke("schedule:deleteBlock", blockId),
  saveScheduleSettings: (input) => ipcRenderer.invoke("schedule:saveSettings", input),
  completeScheduleAppointmentForVisit: (visitId) => ipcRenderer.invoke("schedule:completeForVisit", visitId),
  getDocumentOnlySnapshot: () => ipcRenderer.invoke("documents:getSnapshot"),
  getPatientDetail: (patientId) => ipcRenderer.invoke("patient:getDetail", patientId),
  listCompleted: () => ipcRenderer.invoke("completed:list"),
  listArchive: () => ipcRenderer.invoke("archive:list"),
  savePatient: (input) => ipcRenderer.invoke("patient:save", input),
  archivePatient: (patientId) => ipcRenderer.invoke("patient:archive", patientId),
  restorePatient: (patientId) => ipcRenderer.invoke("patient:restore", patientId),
  deletePatient: (patientId) => ipcRenderer.invoke("patient:delete", patientId),
  permanentlyDeletePatient: (patientId) => ipcRenderer.invoke("patient:permanentDelete", patientId),
  pickPatientArchive: () => ipcRenderer.invoke("patient:pickArchive"),
  exportPatientArchive: (patientId) => ipcRenderer.invoke("patient:exportArchive", patientId),
  preflightPatientArchive: (archive) => ipcRenderer.invoke("patient:preflightArchive", archive),
  readPatientArchive: (archive) => ipcRenderer.invoke("patient:readArchive", archive),
  restorePatientArchive: (archive) => ipcRenderer.invoke("patient:restoreArchive", archive),

  saveCourse: (input) => ipcRenderer.invoke("course:save", input),
  saveDocumentOnlyRecord: (input) => ipcRenderer.invoke("documents:saveRecord", input),
  deleteDocumentOnlyRecord: (recordId) => ipcRenderer.invoke("documents:deleteRecord", recordId),
  generateDocumentOnlyConsent: (recordId) => ipcRenderer.invoke("documents:generateConsent", recordId),
  finalizeDocumentOnlyConsent: (recordId, input) =>
    ipcRenderer.invoke("documents:finalizeConsent", recordId, input),
  generateDocumentOnlySimWorksheet: (recordId) => ipcRenderer.invoke("documents:generateSimWorksheet", recordId),
  completeCourse: (courseId) => ipcRenderer.invoke("course:complete", courseId),
  restoreCourse: (courseId) => ipcRenderer.invoke("course:restore", courseId),
  deleteCourse: (courseId) => ipcRenderer.invoke("course:delete", courseId),

  buildVisitDraft: (courseId, mode, existingVisitId, options) =>
    ipcRenderer.invoke("visit:buildDraft", courseId, mode, existingVisitId, options),
  saveVisit: (input) => ipcRenderer.invoke("visit:save", input),
  deleteVisit: (visitId) => ipcRenderer.invoke("visit:delete", visitId),
  generatePdf: (visitId) => ipcRenderer.invoke("visit:generatePdf", visitId),
  generateSimWorksheet: (visitId) => ipcRenderer.invoke("visit:generateSimWorksheet", visitId),
  generateConsentForm: (courseId) => ipcRenderer.invoke("course:generateConsentForm", courseId),
  generateCourseSimWorksheet: (courseId) => ipcRenderer.invoke("course:generateSimWorksheet", courseId),
  finalizeConsentForm: (courseId, input) => ipcRenderer.invoke("course:finalizeConsentForm", courseId, input),
  uploadConsentForm: (courseId, upload) => ipcRenderer.invoke("course:uploadConsentForm", courseId, upload),
  deleteConsentForm: (courseId) => ipcRenderer.invoke("course:deleteConsentForm", courseId),
  getVisitFolder: (visitId) => ipcRenderer.invoke("visit:getFolder", visitId),
  removeVisitPhoto: (photoId) => ipcRenderer.invoke("visit:removePhoto", photoId),
  removeVisitAttachment: (attachmentId) => ipcRenderer.invoke("visit:removeAttachment", attachmentId),

  getSettingsPayload: () => ipcRenderer.invoke("settings:getPayload"),
  saveSettings: (input) => ipcRenderer.invoke("settings:save", input),
  rememberSavedOption: (type, value) => ipcRenderer.invoke("settings:rememberSavedOption", type, value),
  deleteSavedOption: (optionId) => ipcRenderer.invoke("settings:deleteSavedOption", optionId),

  getTemplates: () => ipcRenderer.invoke("templates:list"),
  saveTemplate: (templateId, templateText) => ipcRenderer.invoke("templates:save", templateId, templateText),
  resetTemplate: (templateId) => ipcRenderer.invoke("templates:reset", templateId),

  resolveAssetUrl: (asset) => Promise.resolve(asset ? `asset://local/${asset.assetId}` : null),
  revealPath: (targetPath) => ipcRenderer.invoke("files:reveal", targetPath),
  openPath: (targetPath) => ipcRenderer.invoke("files:open", targetPath),
  revealAsset: (asset) => ipcRenderer.invoke("files:revealAsset", asset),
  openAsset: (asset) => ipcRenderer.invoke("files:openAsset", asset)
};

contextBridge.exposeInMainWorld("rtNoteApi", api);
