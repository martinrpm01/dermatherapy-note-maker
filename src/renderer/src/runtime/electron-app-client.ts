import type { AppClient, ElectronApi } from "../../../shared/types";

export class ElectronAppClient implements AppClient {
  constructor(private readonly api: ElectronApi) {}

  bootstrap() {
    return this.api.bootstrap();
  }

  reportReady(screen: Parameters<AppClient["reportReady"]>[0]) {
    return this.api.reportReady(screen);
  }

  unlock(pin: string) {
    return this.api.unlock(pin);
  }

  lock() {
    return this.api.lock();
  }

  setInitialPin(pin: string) {
    return this.api.setInitialPin(pin);
  }

  changePin(currentPin: string, nextPin: string) {
    return this.api.changePin(currentPin, nextPin);
  }

  resetPinWithRecoveryCode(recoveryCode: string, nextPin: string) {
    return this.api.resetPinWithRecoveryCode(recoveryCode, nextPin);
  }

  wipeAllLocalData() {
    return this.api.wipeAllLocalData();
  }

  checkForUpdates() {
    return this.api.checkForUpdates();
  }

  openUpdateDownload() {
    return this.api.openUpdateDownload();
  }

  getDashboardSnapshot() {
    return this.api.getDashboardSnapshot();
  }

  getScheduleSnapshot(startDate: string, endDate: string) {
    return this.api.getScheduleSnapshot(startDate, endDate);
  }

  saveScheduleAppointment(input: Parameters<AppClient["saveScheduleAppointment"]>[0]) {
    return this.api.saveScheduleAppointment(input);
  }

  deleteScheduleAppointment(appointmentId: string) {
    return this.api.deleteScheduleAppointment(appointmentId);
  }

  deleteCourseTreatmentSchedule(courseId: string) {
    return this.api.deleteCourseTreatmentSchedule(courseId);
  }

  updateScheduleAppointmentStatus(
    appointmentId: string,
    status: Parameters<AppClient["updateScheduleAppointmentStatus"]>[1]
  ) {
    return this.api.updateScheduleAppointmentStatus(appointmentId, status);
  }

  saveScheduleBlock(input: Parameters<AppClient["saveScheduleBlock"]>[0]) {
    return this.api.saveScheduleBlock(input);
  }

  deleteScheduleBlock(blockId: string) {
    return this.api.deleteScheduleBlock(blockId);
  }

  saveScheduleSettings(input: Parameters<AppClient["saveScheduleSettings"]>[0]) {
    return this.api.saveScheduleSettings(input);
  }

  completeScheduleAppointmentForVisit(visitId: string) {
    return this.api.completeScheduleAppointmentForVisit(visitId);
  }

  getDocumentOnlySnapshot() {
    return this.api.getDocumentOnlySnapshot();
  }

  getPatientDetail(patientId: string) {
    return this.api.getPatientDetail(patientId);
  }

  listCompleted() {
    return this.api.listCompleted();
  }

  listArchive() {
    return this.api.listArchive();
  }

  savePatient(input: Parameters<AppClient["savePatient"]>[0]) {
    return this.api.savePatient(input);
  }

  archivePatient(patientId: string) {
    return this.api.archivePatient(patientId);
  }

  restorePatient(patientId: string) {
    return this.api.restorePatient(patientId);
  }

  deletePatient(patientId: string) {
    return this.api.deletePatient(patientId);
  }

  permanentlyDeletePatient(patientId: string) {
    return this.api.permanentlyDeletePatient(patientId);
  }

  pickPatientArchive() {
    return this.api.pickPatientArchive();
  }

  exportPatientArchive(patientId: string) {
    return this.api.exportPatientArchive(patientId);
  }

  preflightPatientArchive(archivePath: Parameters<AppClient["preflightPatientArchive"]>[0]) {
    return this.api.preflightPatientArchive(archivePath);
  }

  readPatientArchive(archivePath: Parameters<AppClient["readPatientArchive"]>[0]) {
    return this.api.readPatientArchive(archivePath);
  }

  restorePatientArchive(archivePath: Parameters<AppClient["restorePatientArchive"]>[0]) {
    return this.api.restorePatientArchive(archivePath);
  }

  saveCourse(input: Parameters<AppClient["saveCourse"]>[0]) {
    return this.api.saveCourse(input);
  }

  saveDocumentOnlyRecord(input: Parameters<AppClient["saveDocumentOnlyRecord"]>[0]) {
    return this.api.saveDocumentOnlyRecord(input);
  }

  deleteDocumentOnlyRecord(recordId: string) {
    return this.api.deleteDocumentOnlyRecord(recordId);
  }

  generateDocumentOnlyConsent(recordId: string) {
    return this.api.generateDocumentOnlyConsent(recordId);
  }

  finalizeDocumentOnlyConsent(recordId: string, input: Parameters<AppClient["finalizeDocumentOnlyConsent"]>[1]) {
    return this.api.finalizeDocumentOnlyConsent(recordId, input);
  }

  generateDocumentOnlyConsultQuestionnaire(
    recordId: string,
    input: Parameters<AppClient["generateDocumentOnlyConsultQuestionnaire"]>[1]
  ) {
    return this.api.generateDocumentOnlyConsultQuestionnaire(recordId, input);
  }

  generateDocumentOnlySimWorksheet(recordId: string) {
    return this.api.generateDocumentOnlySimWorksheet(recordId);
  }

  generateDocumentOnlyCompletedLesionForm(
    recordId: string,
    options?: Parameters<AppClient["generateDocumentOnlyCompletedLesionForm"]>[1]
  ) {
    return this.api.generateDocumentOnlyCompletedLesionForm(recordId, options);
  }

  completeCourse(courseId: string) {
    return this.api.completeCourse(courseId);
  }

  restoreCourse(courseId: string) {
    return this.api.restoreCourse(courseId);
  }

  deleteCourse(courseId: string) {
    return this.api.deleteCourse(courseId);
  }

  buildVisitDraft(
    courseId: string,
    mode?: Parameters<AppClient["buildVisitDraft"]>[1],
    existingVisitId?: string,
    options?: Parameters<AppClient["buildVisitDraft"]>[3]
  ) {
    return this.api.buildVisitDraft(courseId, mode, existingVisitId, options);
  }

  saveVisit(input: Parameters<AppClient["saveVisit"]>[0]) {
    return this.api.saveVisit(input);
  }

  deleteVisit(visitId: string) {
    return this.api.deleteVisit(visitId);
  }

  generatePdf(visitId: string) {
    return this.api.generatePdf(visitId);
  }

  generateSimWorksheet(visitId: string) {
    return this.api.generateSimWorksheet(visitId);
  }

  generateConsentForm(courseId: string) {
    return this.api.generateConsentForm(courseId);
  }

  generateCourseConsultQuestionnaire(
    courseId: string,
    input: Parameters<AppClient["generateCourseConsultQuestionnaire"]>[1]
  ) {
    return this.api.generateCourseConsultQuestionnaire(courseId, input);
  }

  generateCourseSimWorksheet(courseId: string) {
    return this.api.generateCourseSimWorksheet(courseId);
  }

  generateCourseCompletedLesionForm(
    courseId: string,
    options?: Parameters<AppClient["generateCourseCompletedLesionForm"]>[1]
  ) {
    return this.api.generateCourseCompletedLesionForm(courseId, options);
  }

  finalizeConsentForm(courseId: string, input: Parameters<AppClient["finalizeConsentForm"]>[1]) {
    return this.api.finalizeConsentForm(courseId, input);
  }

  uploadConsentForm(courseId: string, upload: Parameters<AppClient["uploadConsentForm"]>[1]) {
    return this.api.uploadConsentForm(courseId, upload);
  }

  deleteConsentForm(courseId: string) {
    return this.api.deleteConsentForm(courseId);
  }

  getVisitFolder(visitId: string) {
    return this.api.getVisitFolder(visitId);
  }

  removeVisitPhoto(photoId: string) {
    return this.api.removeVisitPhoto(photoId);
  }

  removeVisitAttachment(attachmentId: string) {
    return this.api.removeVisitAttachment(attachmentId);
  }

  getSettingsPayload() {
    return this.api.getSettingsPayload();
  }

  saveSettings(input: Parameters<AppClient["saveSettings"]>[0]) {
    return this.api.saveSettings(input);
  }

  rememberSavedOption(type: Parameters<AppClient["rememberSavedOption"]>[0], value: string) {
    return this.api.rememberSavedOption(type, value);
  }

  deleteSavedOption(optionId: string) {
    return this.api.deleteSavedOption(optionId);
  }

  getTemplates() {
    return this.api.getTemplates();
  }

  saveTemplate(templateId: string, templateText: string) {
    return this.api.saveTemplate(templateId, templateText);
  }

  resetTemplate(templateId: string) {
    return this.api.resetTemplate(templateId);
  }

  resolveAssetUrl(asset: Parameters<AppClient["resolveAssetUrl"]>[0]) {
    return this.api.resolveAssetUrl(asset);
  }

  revealAsset(asset: Parameters<AppClient["revealAsset"]>[0]) {
    return this.api.revealAsset(asset);
  }

  openAsset(asset: Parameters<AppClient["openAsset"]>[0]) {
    return this.api.openAsset(asset);
  }

  revealPath(targetPath: string) {
    return this.api.revealPath(targetPath);
  }

  openPath(targetPath: string) {
    return this.api.openPath(targetPath);
  }
}
