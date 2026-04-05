import { useEffect, useState } from "react";
import type { PatientArchiveExportResult, PatientArchivePreflightResult, PatientArchiveRestoreBlocker, PatientArchiveRestoreResult, PatientArchiveValidationIssue } from "../../shared/archive";
import { TEMPLATE_PLACEHOLDERS } from "../../shared/templates";
import type { AppClient, ArchiveSnapshot, AssetReference, DashboardSnapshot, PatientDetail, SettingsPayload, TemplateDefinitionRecord, AppSettingsView } from "../../shared/types";
import { formatDisplayDate } from "../../shared/note-rules";
import { useResolvedAssetUrl } from "./asset-url";

function patientDisplayName(detail: PatientDetail["patient"]) {
  return `${detail.lastName}, ${detail.firstName}`;
}

function matchesSearch(value: string, search: string) {
  if (!search.trim()) {
    return true;
  }

  return value.toLowerCase().includes(search.trim().toLowerCase());
}

function isDashboardCourseRow(
  row: DashboardSnapshot["activeCourses"][number] | DashboardSnapshot["patientsWithoutCourse"][number]
): row is DashboardSnapshot["activeCourses"][number] {
  return "courseId" in row;
}

function buildActiveSearchMatches(dashboard: DashboardSnapshot | null, search: string) {
  if (!search.trim() || !dashboard) {
    return [];
  }

  const rows = [...dashboard.activeCourses, ...dashboard.patientsWithoutCourse];
  const seen = new Set<string>();

  return rows.filter((row) => {
    if (seen.has(row.patientId)) {
      return false;
    }
    seen.add(row.patientId);
    const courseText = isDashboardCourseRow(row) ? `${row.courseName} ${row.siteSummary}` : "";
    return matchesSearch(`${row.patientName} ${row.patientMrn} ${courseText}`, search);
  });
}

function buildPatientDetailMatches(details: PatientDetail[], search: string) {
  if (!search.trim()) {
    return [];
  }

  return details.filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((course) => course.course.courseName).join(" ")}`,
      search
    )
  );
}

type BlockedPreflightSection = {
  title: string;
  items: string[];
  guidance: string[];
};

function getPathFileName(value: string) {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || value;
}

function formatRestoreModeLabel(result: PatientArchivePreflightResult) {
  if (result.restoreMode === "merge_existing_patient") {
    return `Merge completed history into existing patient ${result.targetPatientId}`;
  }

  if (result.restoreMode === "new_patient") {
    return `Restore as patient ${result.targetPatientId}`;
  }

  return "Not restorable in the current phase";
}

function ArchivePathSummary(props: {
  fileLabel?: string;
  fileName: string;
  pathLabel: string;
  pathValue: string;
}) {
  return (
    <div className="muted" style={{ fontSize: "0.9rem", marginBottom: "0.8rem" }}>
      <div>{props.fileLabel ?? "Archive file"}: {props.fileName}</div>
      <div>{props.pathLabel}: {props.pathValue}</div>
    </div>
  );
}

function ArchiveCountSummary(props: {
  title: string;
  lines: string[];
  marginBottom?: string;
}) {
  return (
    <div style={{ marginBottom: props.marginBottom ?? "0.8rem" }}>
      <strong>{props.title}</strong>
      <div className="muted" style={{ fontSize: "0.9rem", marginTop: "0.35rem" }}>
        {props.lines.map((line, index) => (
          <div key={`${props.title}-${index}`}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function PatientAvatar(props: {
  appClient: AppClient | null;
  asset: AssetReference | null | undefined;
}) {
  const src = useResolvedAssetUrl(props.appClient, props.asset);
  return src ? <img className="patient-row-avatar" src={src} alt="" /> : <div className="patient-row-avatar-placeholder" />;
}

function categorizeValidationIssue(issue: PatientArchiveValidationIssue) {
  switch (issue.code) {
    case "archive_open_failed":
    case "json_parse_failed":
    case "invalid_json_shape":
    case "invalid_archive_type":
      return "invalid_archive";
    case "unsupported_archive_version":
      return "unsupported_archive";
    case "missing_required_entry":
    case "missing_asset_file_entry":
      return "missing_archive_contents";
  }
}

function categorizeRestoreBlocker(blocker: PatientArchiveRestoreBlocker) {
  switch (blocker.code) {
    case "invalid_archive":
      return "invalid_archive";
    case "missing_asset_entry":
      return "missing_archive_contents";
    case "active_course_not_supported":
      return "active_course_blocked";
    case "ambiguous_patient_identity":
    case "conflicting_patient_id":
    case "conflicting_patient_identity":
    case "conflicting_course_id":
    case "conflicting_site_id":
    case "conflicting_visit_id":
    case "conflicting_visit_photo_id":
    case "conflicting_visit_attachment_id":
    case "conflicting_generated_pdf_id":
    case "conflicting_generated_pdf_output_path":
      return "merge_conflict_blocked";
  }
}

function buildBlockedPreflightSections(preflightResult: PatientArchivePreflightResult): BlockedPreflightSection[] {
  const buckets = new Map<string, BlockedPreflightSection>();

  const ensureBucket = (key: string, title: string, guidance: string[]) => {
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }

    const created: BlockedPreflightSection = { title, items: [], guidance };
    buckets.set(key, created);
    return created;
  };

  for (const issue of preflightResult.validationIssues) {
    const category = categorizeValidationIssue(issue);
    if (!category) {
      continue;
    }

    switch (category) {
      case "invalid_archive":
        ensureBucket(
          category,
          "Invalid Archive",
          [
            "Use a patient archive ZIP created by Dermatherapy Note Maker.",
            "If this ZIP was edited, re-export the patient archive from the source device before trying again."
          ]
        ).items.push(issue.message);
        break;
      case "unsupported_archive":
        ensureBucket(
          category,
          "Unsupported Archive Version",
          [
            "Use a restore archive created by a compatible version of Dermatherapy Note Maker.",
            "If the source device is ahead of this app version, update this desktop app before retrying."
          ]
        ).items.push(issue.message);
        break;
      case "missing_archive_contents":
        ensureBucket(
          category,
          "Missing Archive Contents",
          [
            "Pick a complete patient archive ZIP and avoid manually editing its contents.",
            "If the archive came from another device, re-export it so all required files are bundled."
          ]
        ).items.push(issue.message);
        break;
    }
  }

  for (const blocker of preflightResult.restoreBlockers) {
    const category = categorizeRestoreBlocker(blocker);
    if (!category) {
      continue;
    }

    switch (category) {
      case "invalid_archive":
        ensureBucket(
          category,
          "Invalid Archive",
          [
            "Use a patient archive ZIP created by Dermatherapy Note Maker.",
            "If this ZIP was edited, re-export the patient archive from the source device before trying again."
          ]
        ).items.push(blocker.message);
        break;
      case "missing_archive_contents":
        ensureBucket(
          category,
          "Missing Archive Contents",
          [
            "Pick a complete patient archive ZIP and avoid manually editing its contents.",
            "If the archive came from another device, re-export it so all required files are bundled."
          ]
        ).items.push(blocker.message);
        break;
      case "active_course_blocked":
        ensureBucket(
          category,
          "Unsupported Restore Case",
          [
            "This phase only restores completed treatment history.",
            "Complete or archive active treatment on the source device before exporting a new archive."
          ]
        ).items.push(blocker.message);
        break;
      case "merge_conflict_blocked":
        ensureBucket(
          category,
          "Merge Or Conflict Blocked",
          [
            "This archive needs conflict handling that is not supported in the current phase.",
            "Pick a different archive or wait for a later version with broader merge support."
          ]
        ).items.push(blocker.message);
        break;
    }
  }

  return [...buckets.values()];
}

function CrossLocationSearchResults(props: {
  appClient: AppClient | null;
  search: string;
  currentSection: "active" | "completed" | "archive";
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  archive: ArchiveSnapshot | null;
  onOpenPatient: (patientId: string) => void;
  onRestoreArchivedPatient: (patientId: string) => void;
}) {
  if (!props.search.trim()) {
    return null;
  }

  const activeMatches = props.currentSection === "active" ? [] : buildActiveSearchMatches(props.dashboard, props.search);
  const completedMatches = props.currentSection === "completed" ? [] : buildPatientDetailMatches(props.completed?.patients || [], props.search);
  const archiveMatches = props.currentSection === "archive" ? [] : buildPatientDetailMatches(props.archive?.patients || [], props.search);

  if (!activeMatches.length && !completedMatches.length && !archiveMatches.length) {
    return null;
  }

  return (
    <section className="panel">
      <div className="section-header">
        <div>
          <h3>Also Found In Other Sections</h3>
          <p>Matching patients from the rest of the app.</p>
        </div>
      </div>
      <div className="patient-list">
        {activeMatches.map((row) => (
          <article className="patient-row-card patient-row-grouped" key={`active-${row.patientId}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={row.patientFacePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{row.patientName}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Active Workflow</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onOpenPatient(row.patientId)}>Open Patient</button>
              </div>
            </div>
          </article>
        ))}
        {completedMatches.map((detail) => (
          <article className="patient-row-card patient-row-grouped" key={`completed-${detail.patient.id}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Completed Patients</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onOpenPatient(detail.patient.id)}>Open Patient</button>
              </div>
            </div>
          </article>
        ))}
        {archiveMatches.map((detail) => (
          <article className="patient-row-card patient-row-grouped" key={`archive-${detail.patient.id}`}>
            <div className="patient-row-grouped-header">
              <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
              <div className="patient-row-identity">
                <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>Found in Archive</div>
              </div>
              <div className="patient-row-actions">
                <button onClick={() => props.onRestoreArchivedPatient(detail.patient.id)}>Restore</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function LockScreen(props: {
  appName: string;
  logoSrc?: string;
  requiresPinSetup: boolean;
  statusMessage: string;
  unlockPin: string;
  setupPin: string;
  confirmPin: string;
  setupSettings: AppSettingsView;
  onUnlockPinChange: (value: string) => void;
  onSetupPinChange: (value: string) => void;
  onConfirmPinChange: (value: string) => void;
  onSetupSettingsChange: (settings: AppSettingsView) => void;
  onSetupLogoSelected: (file: File | undefined) => void;
  onRemoveSetupLogo: () => void;
  onUnlock: () => void;
  onSetup: () => void;
  onForgotPin?: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className={`lock-card${props.requiresPinSetup ? " lock-card-setup" : ""}`}>
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>{props.requiresPinSetup ? "Set a local PIN to protect patient notes on this device." : "Unlock with PIN to access patient records."}</p>
        {props.requiresPinSetup ? (
          <div className="settings-grid lock-setup-grid">
            <div className="panel">
              <label>
                Default Therapist
                <input
                  value={props.setupSettings.defaultTherapist}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, defaultTherapist: event.target.value })}
                />
              </label>
              <label>
                Supervising Physician Name
                <input
                  placeholder="e.g. David S. Sax, M.D."
                  value={props.setupSettings.supervisingPhysician}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, supervisingPhysician: event.target.value })}
                />
              </label>
              <label>
                Dermatology Office Name
                <input
                  placeholder="e.g. University Park Dermatology"
                  value={props.setupSettings.dermatologyOfficeName}
                  onChange={(event) => props.onSetupSettingsChange({ ...props.setupSettings, dermatologyOfficeName: event.target.value })}
                />
              </label>
              <div className="logo-settings">
                <span className="strong">Dermatology Office Logo</span>
                <img className="settings-logo-preview" src={props.setupSettings.dermatologyOfficeLogoUpload?.dataUrl || props.logoSrc} alt="Dermatology office logo preview" />
                <div className="button-row">
                  <label className="logo-upload-button">
                    Upload Logo
                    <input type="file" accept="image/*" onChange={(event) => props.onSetupLogoSelected(event.target.files?.[0])} />
                  </label>
                  <button type="button" onClick={props.onRemoveSetupLogo}>
                    Use Default Logo
                  </button>
                </div>
              </div>
            </div>
            <div className="panel lock-setup-pin-panel">
              <h3>Set PIN</h3>
              <input type="password" inputMode="numeric" placeholder="New PIN" value={props.setupPin} onChange={(event) => props.onSetupPinChange(event.target.value)} />
              <input type="password" inputMode="numeric" placeholder="Confirm PIN" value={props.confirmPin} onChange={(event) => props.onConfirmPinChange(event.target.value)} />
              <button className="primary" onClick={props.onSetup}>
                Save Setup
              </button>
            </div>
          </div>
        ) : (
          <>
            <input type="password" inputMode="numeric" placeholder="PIN" value={props.unlockPin} onChange={(event) => props.onUnlockPinChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") props.onUnlock(); }} />
            <button className="primary" onClick={props.onUnlock}>
              Unlock
            </button>
            {props.onForgotPin ? (
              <button className="ghost" onClick={props.onForgotPin}>
                Forgot PIN?
              </button>
            ) : null}
          </>
        )}
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
      </div>
    </div>
  );
}

export function InstallPromptBanner(props: {
  onDismiss: () => void;
}) {
  return (
    <aside className="install-helper-banner" role="dialog" aria-label="Add to your Home Screen">
      <div className="install-helper-copy">
        <strong>Add to your Home Screen</strong>
        <p>For the best iPad experience, install Dermatherapy Note Maker so it opens like a native app.</p>
        <ol>
          <li>Tap the Safari Share button, the square with an upward arrow.</li>
          <li>Scroll down and tap Add to Home Screen.</li>
          <li>Tap Add.</li>
        </ol>
      </div>
      <div className="install-helper-actions">
        <span className="install-helper-hint">Safari only. This prompt goes away once dismissed or installed.</span>
        <button className="ghost" onClick={props.onDismiss}>Maybe Later</button>
      </div>
    </aside>
  );
}

export function RecoveryCodeScreen(props: {
  appName: string;
  logoSrc?: string;
  recoveryCode: string;
  onAcknowledge: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>Write down this recovery code and store it somewhere safe. It will not be shown again.</p>
        <div
          style={{
            fontSize: "1.6rem",
            letterSpacing: "0.16rem",
            fontWeight: 700,
            textAlign: "center",
            padding: "0.9rem",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.55)"
          }}
        >
          {props.recoveryCode}
        </div>
        <p className="inline-message">If you forget your PIN and lose this code, the only recovery option will be to wipe all local data on this device.</p>
        <button className="primary" onClick={props.onAcknowledge}>
          I Wrote It Down
        </button>
      </div>
    </div>
  );
}

export function PinRecoveryScreen(props: {
  appName: string;
  logoSrc?: string;
  recoveryCode: string;
  nextPin: string;
  confirmPin: string;
  statusMessage: string;
  showWipeOption: boolean;
  onRecoveryCodeChange: (value: string) => void;
  onNextPinChange: (value: string) => void;
  onConfirmPinChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onWipe: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p>Enter your recovery code to set a new PIN for this device.</p>
        <input
          type="text"
          autoCapitalize="characters"
          placeholder="Recovery Code"
          value={props.recoveryCode}
          onChange={(event) => props.onRecoveryCodeChange(event.target.value.toUpperCase())}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder="New PIN"
          value={props.nextPin}
          onChange={(event) => props.onNextPinChange(event.target.value)}
        />
        <input
          type="password"
          inputMode="numeric"
          placeholder="Confirm New PIN"
          value={props.confirmPin}
          onChange={(event) => props.onConfirmPinChange(event.target.value)}
        />
        <div className="button-row">
          <button className="primary" onClick={props.onSubmit}>
            Reset PIN
          </button>
          <button onClick={props.onCancel}>Back</button>
        </div>
        <button
          className="ghost"
          style={{ fontSize: "0.9rem", padding: "0.25rem 0.5rem", alignSelf: "center" }}
          onClick={props.onWipe}
        >
          Don&apos;t have your recovery code? Wipe local data
        </button>
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
        {props.showWipeOption ? (
          <button className="ghost" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={props.onWipe}>
            Wipe Local Data
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function WipeLocalDataScreen(props: {
  appName: string;
  logoSrc?: string;
  confirmationText: string;
  statusMessage: string;
  onConfirmationTextChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="lock-shell">
      <div className="lock-card">
        {props.logoSrc ? <img className="brand-logo lock-logo" src={props.logoSrc} alt={`${props.appName} logo`} /> : null}
        <h1>{props.appName}</h1>
        <p style={{ color: "var(--danger)" }}>This will permanently delete all local patient data stored on this device.</p>
        <p className="inline-message">
          This cannot be undone. Any data not previously exported will be lost. Type <strong>WIPE MY DATA</strong> to enable the wipe button.
        </p>
        <input
          type="text"
          placeholder="Type WIPE MY DATA"
          value={props.confirmationText}
          onChange={(event) => props.onConfirmationTextChange(event.target.value)}
        />
        <div className="button-row">
          <button
            className="primary"
            style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
            disabled={props.confirmationText !== "WIPE MY DATA"}
            onClick={props.onConfirm}
          >
            Permanently Wipe Local Data
          </button>
          <button onClick={props.onCancel}>Cancel</button>
        </div>
        {props.statusMessage ? <p className="inline-message">{props.statusMessage}</p> : null}
      </div>
    </div>
  );
}


export function DashboardScreen(props: {
  appClient: AppClient | null;
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  archive: ArchiveSnapshot | null;
  search: string;
  onSearchChange: (value: string) => void;
  onAddPatient: () => void;
  onOpenPatient: (patientId: string) => void;
  onOpenVisit: (courseId: string, mode: "next_treatment" | "consult_sim") => void;
  onCompletePatient: (patientId: string) => void;
  onRestoreArchivedPatient: (patientId: string) => void;
}) {
  const allCourseRows = props.dashboard?.activeCourses || [];
  const noCourseRows = props.dashboard?.patientsWithoutCourse || [];

  // Collect unique patients (from courses + no-course rows), preserve order
  const patientIds: string[] = [];
  const seen = new Set<string>();
  for (const row of [...allCourseRows, ...noCourseRows]) {
    if (!seen.has(row.patientId)) { seen.add(row.patientId); patientIds.push(row.patientId); }
  }

  // Filter by search at the patient level
  const filteredIds = patientIds.filter((id) => {
    const courses = allCourseRows.filter((r) => r.patientId === id);
    const noC = noCourseRows.find((r) => r.patientId === id);
    const ref = courses[0] || noC!;
    return matchesSearch(`${ref.patientName} ${ref.patientMrn} ${courses.map((c) => `${c.courseName} ${c.siteSummary}`).join(" ")}`, props.search);
  });

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Active Patients</h2>
          <p>Current fraction count, suggested note type, and quick actions for today's workflow.</p>
        </div>
        <button className="primary" onClick={props.onAddPatient}>
          Add Patient
        </button>
      </div>
      <input className="search" placeholder="Search patient, MRN, course, or lesion" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="active"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestoreArchivedPatient}
      />
      <div className="patient-list">
        {filteredIds.map((patientId) => {
          const courses = allCourseRows.filter((r) => r.patientId === patientId);
          const noC = noCourseRows.find((r) => r.patientId === patientId);
          const ref = courses[0] || noC!;
          return (
            <article className="patient-row-card patient-row-grouped" key={patientId}>
              <div className="patient-row-grouped-header">
                <PatientAvatar appClient={props.appClient} asset={ref.patientFacePhoto} />
                <div className="patient-row-identity">
                  <div className="patient-row-name">{ref.patientName}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>MRN {ref.patientMrn} · DOB {formatDisplayDate(ref.patientDob)}</div>
                </div>
                <div className="patient-row-actions">
                  <button onClick={() => props.onOpenPatient(patientId)}>Open Patient</button>
                  {courses.length > 0 ? (
                    <button onClick={() => props.onCompletePatient(patientId)}>Treatment Completed</button>
                  ) : null}
                </div>
              </div>
              {courses.length === 0 ? (
                <div className="patient-row-course-sub muted">No active treatment course</div>
              ) : courses.map((row) => (
                <div className="patient-row-course-sub" key={row.courseId}>
                  <div className="patient-row-course">
                    <div className="strong" style={{ fontSize: "0.92rem" }}>{row.courseName}</div>
                    {row.siteSummary ? <div className="muted" style={{ fontSize: "0.85rem" }}>{row.siteSummary}</div> : null}
                  </div>
                  <div className="patient-row-stats">
                    {row.prescribedFractions > 0 ? (
                      <>
                        <span>{`Fraction ${row.currentFraction} / ${row.prescribedFractions}`}</span>
                        <span>{row.suggestedNoteType === "consult_sim" ? "Sim / Consult" : row.suggestedNoteType.replace(/_/g, " ")}</span>
                      </>
                    ) : (
                      <span>Sim / Consult</span>
                    )}
                  </div>
                  <div className="patient-row-actions">
                    <button className="primary" onClick={() => props.onOpenVisit(row.courseId, "next_treatment")}>Start Today's Note</button>
                  </div>
                </div>
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PatientScreen(props: {
  appClient: AppClient | null;
  patientDetail: PatientDetail;
  onEditPatient: () => void;
  onAddCourse: () => void;
  onEditCourse: (courseId: string) => void;
  onArchivePatient: () => void;
  onCompletePatient: () => void;
  onOpenVisit: (courseId: string, mode: "next_treatment" | "consult_sim", existingVisitId?: string) => void;
  onCompleteCourse: (courseId: string) => void;
  onRestoreCourse: (courseId: string) => void;
  onOpenPdf: (asset: AssetReference) => void;
  onDeleteVisit: (visitId: string) => void;
}) {
  const detail = props.patientDetail;
  const facePhotoSrc = useResolvedAssetUrl(props.appClient, detail.patient.facePhoto);
  const hasActiveCourse = detail.courses.some((cd) => cd.course.status === "active");
  const defaultSelectedCourseId = detail.courses.find((courseDetail) => courseDetail.course.status === "active")?.course.id
    ?? detail.courses[0]?.course.id
    ?? "all";
  const [selectedCourseId, setSelectedCourseId] = useState<string>(defaultSelectedCourseId);

  useEffect(() => {
    setSelectedCourseId(defaultSelectedCourseId);
  }, [defaultSelectedCourseId]);

  const visibleCourses = selectedCourseId === "all"
    ? detail.courses
    : detail.courses.filter((cd) => cd.course.id === selectedCourseId);
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>{patientDisplayName(detail.patient)}</h2>
          <p>MRN {detail.patient.mrn} · DOB {formatDisplayDate(detail.patient.dob)}</p>
        </div>
        <div className="button-row">
          {detail.courses.length > 1 ? (
            <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)} style={{ fontSize: "0.9rem" }}>
              <option value="all">All Courses</option>
              {detail.courses.map((cd) => (
                <option key={cd.course.id} value={cd.course.id}>
                  {cd.course.courseName} ({cd.course.status})
                </option>
              ))}
            </select>
          ) : null}
          <button onClick={props.onEditPatient}>Edit Patient</button>
          <button className="primary" onClick={props.onAddCourse}>Add Course</button>
          {hasActiveCourse ? (
            <button className="primary" style={{ background: "var(--accent-strong)", borderColor: "var(--accent-strong)" }} onClick={props.onCompletePatient}>
              Treatment Complete
            </button>
          ) : null}
          <button onClick={props.onArchivePatient}>Archive Patient</button>
        </div>
      </div>
      {detail.patient.facePhoto ? (
        <div className="profile-row">
          {facePhotoSrc ? <img className="face-photo" src={facePhotoSrc} alt="" /> : null}
        </div>
      ) : null}
      {visibleCourses.map((courseDetail) => (
        <section className="panel" key={courseDetail.course.id}>
          <div className="section-header">
            <div>
              <h3>{courseDetail.course.courseName}</h3>
              <p>{courseDetail.course.prescribedFractions > 0 ? `${courseDetail.course.prescribedFractions} prescribed fractions` : "Sim / Consult"}</p>
              <p>
                {courseDetail.course.courseType === "one_site" ? "1-lesion course" : "2-lesion course"} · {courseDetail.course.status}
              </p>
            </div>
            <div className="button-row">
              <button onClick={() => props.onEditCourse(courseDetail.course.id)}>Edit Course</button>
              <button className="primary" onClick={() => props.onOpenVisit(courseDetail.course.id, "next_treatment")}>
                Start Today's Note
              </button>
              {courseDetail.course.status === "active" ? (
                <button onClick={() => props.onCompleteCourse(courseDetail.course.id)}>Treatment Completed</button>
              ) : (
                <button onClick={() => props.onRestoreCourse(courseDetail.course.id)}>Restore Course</button>
              )}
            </div>
          </div>
          <div className="site-grid">
            {courseDetail.sites.map((site) => (
              <div className="subpanel" key={site.id}>
                <h4>Lesion {site.siteNumber}</h4>
                <p>{site.bodyLocation}</p>
                <p>{site.icd10}</p>
                <p>
                  {site.dailyDose} cGy daily · {site.totalDose} cGy total
                </p>
              </div>
            ))}
          </div>
          <div className="visit-list">
            {courseDetail.visits.map((visit) => (
              <div className="visit-row" key={visit.note.id}>
                <div>
                  <strong>{formatDisplayDate(visit.note.visitDate)}</strong>
                  <span>
                    {visit.note.noteType.replace("_", " ")}
                    {visit.note.treatmentNumber ? ` · Fraction ${visit.note.treatmentNumber}` : ""}
                  </span>
                </div>
                <div className="button-row">
                  <button onClick={() => props.onOpenVisit(courseDetail.course.id, "next_treatment", visit.note.id)}>Open Note</button>
                  {visit.note.pdfAsset ? <button onClick={() => props.onOpenPdf(visit.note.pdfAsset!)}>Open PDF</button> : null}
                  <button
                    style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                    onClick={() => {
                      if (window.confirm("Delete this note and its attached PDFs/photos? This cannot be undone.")) {
                        props.onDeleteVisit(visit.note.id);
                      }
                    }}
                  >
                    Delete Note
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function CompletedScreen(props: {
  appClient: AppClient | null;
  completed: ArchiveSnapshot | null;
  dashboard: DashboardSnapshot | null;
  archive: ArchiveSnapshot | null;
  search: string;
  archiveActionBusy: boolean;
  archiveExportBusyPatientId: string | null;
  exportResult: PatientArchiveExportResult | null;
  exportError: string | null;
  preflightResult: PatientArchivePreflightResult | null;
  restoreResult: PatientArchiveRestoreResult | null;
  onSearchChange: (value: string) => void;
  onOpenPatient: (patientId: string) => void;
  onAddCourse: (patientId: string) => void;
  onOpenVisit: (courseId: string, existingVisitId: string) => void;
  onOpenPdf: (asset: AssetReference) => void;
  onExportArchive: (patientId: string) => void;
  onRevealExportPath: (targetPath: string) => void;
  onOpenArchivePath: (targetPath: string) => void;
  onDismissExportResult: () => void;
  onImportArchive: () => void;
  onPickAnotherArchive: () => void;
  onConfirmRestoreArchive: () => void;
  onDismissPreflightResult: () => void;
  onDismissRestoreResult: () => void;
  onRestoreArchivedPatient: (patientId: string) => void;
}) {
  const patients = (props.completed?.patients || []).filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((c) => c.course.courseName).join(" ")}`,
      props.search
    )
  );
  const exportResult = props.exportResult;
  const preflightResult = props.preflightResult;
  const restoreResult = props.restoreResult;
  const blockedSections = preflightResult?.status === "blocked" ? buildBlockedPreflightSections(preflightResult) : [];

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Completed Patients</h2>
          <p>Patients with finished treatment history and no active course. Add a new course to return them to the active workflow, or export a patient archive for backup and transfer.</p>
        </div>
        <div className="button-row">
          <button className="primary" disabled={props.archiveActionBusy} onClick={props.onImportArchive}>
            {props.archiveActionBusy ? "Working..." : "Import Patient Archive"}
          </button>
        </div>
      </div>
      {exportResult || props.exportError ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: exportResult ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{exportResult ? "Archive Exported" : "Archive Export Failed"}</h3>
              <p>
                {exportResult
                  ? "The patient archive was written to local disk using the current desktop export flow. Use the actions on the right to open it or show it in its folder."
                  : "The archive export did not complete. Review the message below and try again."}
              </p>
            </div>
            <div className="button-row">
              {exportResult ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(exportResult.archiveHandle.path)}>Open Archive</button>
                  <button onClick={() => props.onRevealExportPath(exportResult.archiveHandle.path)}>Show In Folder</button>
                </>
              ) : null}
              <button onClick={props.onDismissExportResult}>Dismiss</button>
            </div>
          </div>
          {exportResult ? (
            <>
              <ArchivePathSummary
                fileName={exportResult.archiveHandle.fileName}
                pathLabel="Output path"
                pathValue={exportResult.archiveHandle.path}
              />
              <ArchiveCountSummary
                title="Archive contents"
                lines={[
                  `Bundled asset files: ${exportResult.includedAssetCount}`,
                  `Missing asset files: ${exportResult.missingAssetCount}`,
                  `Archive warnings: ${exportResult.warnings.length}`
                ]}
              />
              {exportResult.warnings.length ? (
                <div>
                  <strong>Export warnings:</strong>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                    {exportResult.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${warning.assetId}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted" style={{ fontSize: "0.9rem" }}>{props.exportError}</div>
          )}
        </section>
      ) : null}
      {preflightResult ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: preflightResult.status === "supported" ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{preflightResult.status === "supported" ? "Archive Ready for Restore" : "Archive Preflight Blocked"}</h3>
              <p>
                {preflightResult.status === "supported"
                  ? "The archive read cleanly and fits the currently supported restore rules. Review the summary below, then choose Restore Archive when you're ready."
                  : "This archive cannot be restored in the current phase. Review the grouped issues below to see what kind of problem occurred and what to do next."}
              </p>
            </div>
            <div className="button-row">
              {preflightResult.status === "supported" ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(preflightResult.sourceArchive.path)}>Open Archive</button>
                  <button className="primary" disabled={props.archiveActionBusy} onClick={props.onConfirmRestoreArchive}>
                    {props.archiveActionBusy ? "Restoring Archive..." : "Restore Archive"}
                  </button>
                </>
              ) : (
                <button className="primary" disabled={props.archiveActionBusy} onClick={props.onPickAnotherArchive}>
                  {props.archiveActionBusy ? "Working..." : "Pick Another Archive"}
                </button>
              )}
              <button onClick={props.onDismissPreflightResult}>{preflightResult.status === "supported" ? "Dismiss" : "Back"}</button>
            </div>
          </div>
          <ArchivePathSummary
            fileName={preflightResult.sourceArchive.fileName}
            pathLabel="Source path"
            pathValue={preflightResult.sourceArchive.path}
          />
          <div className="muted" style={{ fontSize: "0.9rem", marginBottom: "0.8rem" }}>
            {preflightResult.manifest ? (
              <>
                <div>
                  Patient: {preflightResult.manifest.patientIdentity.lastName}, {preflightResult.manifest.patientIdentity.firstName} · MRN {preflightResult.manifest.patientIdentity.mrn} · DOB {formatDisplayDate(preflightResult.manifest.patientIdentity.dob)}
                </div>
                <div>
                  Archive format: {preflightResult.manifest.archiveType} v{preflightResult.manifest.archiveVersion} · prepared {formatDisplayDate(preflightResult.manifest.preparedAt.slice(0, 10))}
                </div>
                <div>
                  Planned action: {formatRestoreModeLabel(preflightResult)}
                </div>
              </>
            ) : (
              <div>The selected ZIP could not be parsed into a valid patient archive manifest.</div>
            )}
          </div>
          {preflightResult.manifest ? (
            <>
              <ArchiveCountSummary
                title="Record counts"
                lines={[
                  `Courses: ${preflightResult.manifest.recordCounts.courses}`,
                  `Sites: ${preflightResult.manifest.recordCounts.sites}`,
                  `Visit notes: ${preflightResult.manifest.recordCounts.visitNotes}`,
                  `Visit photos: ${preflightResult.manifest.recordCounts.visitPhotos}`,
                  `Visit attachments: ${preflightResult.manifest.recordCounts.visitAttachments}`,
                  `Generated PDFs: ${preflightResult.manifest.recordCounts.generatedPdfs}`
                ]}
              />
              <ArchiveCountSummary
                title="Asset counts"
                lines={[
                  `Patient face photos: ${preflightResult.manifest.assetCounts.patient_face_photo}`,
                  `Visit photos: ${preflightResult.manifest.assetCounts.visit_photo}`,
                  `Visit attachments: ${preflightResult.manifest.assetCounts.visit_attachment}`,
                  `Generated PDF files: ${preflightResult.manifest.assetCounts.generated_pdf}`
                ]}
              />
            </>
          ) : null}
          {preflightResult.archiveWarnings.length ? (
            <div style={{ marginBottom: "0.8rem" }}>
              <strong>Archive warnings:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.archiveWarnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.assetId}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preflightResult.status === "blocked" && blockedSections.length ? (
            <div style={{ marginBottom: preflightResult.notices.length ? "0.8rem" : 0 }}>
              {blockedSections.map((section) => (
                <div key={section.title} style={{ marginBottom: "0.8rem" }}>
                  <strong>{section.title}</strong>
                  <ul style={{ margin: "0.5rem 0", paddingLeft: "1.2rem" }}>
                    {section.items.map((item, index) => (
                      <li key={`${section.title}-${index}`}>{item}</li>
                    ))}
                  </ul>
                  <div className="muted" style={{ fontSize: "0.9rem" }}>
                    {section.guidance.join(" ")}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {preflightResult.status === "blocked" && !blockedSections.length && (preflightResult.validationIssues.length || preflightResult.restoreBlockers.length) ? (
            <div style={{ marginBottom: preflightResult.notices.length ? "0.8rem" : 0 }}>
              <strong>Blocked details:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.validationIssues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.entryPath || index}`}>{issue.message}</li>
                ))}
                {preflightResult.restoreBlockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.relatedId || blocker.entryPath || index}`}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preflightResult.notices.length ? (
            <div>
              <strong>{preflightResult.status === "supported" ? "Restore notes:" : "Additional notes:"}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {preflightResult.notices.map((notice, index) => (
                  <li key={`${notice}-${index}`}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {restoreResult ? (
        <section
          className="panel"
          style={{
            marginBottom: "1rem",
            borderColor: restoreResult.status === "restored" ? "var(--accent-strong)" : "var(--danger)"
          }}
        >
          <div className="section-header">
            <div>
              <h3>{restoreResult.status === "restored" ? "Archive Restored" : "Archive Restore Blocked"}</h3>
              <p>
                {restoreResult.status === "restored"
                  ? "The archive was restored into local completed history. Review the summary below, then open the patient record, open the archive ZIP again if needed, or start a new course."
                  : "The archive was not changed locally because the current restore rules could not complete safely."}
              </p>
            </div>
            <div className="button-row">
              {restoreResult.status === "restored" ? (
                <>
                  <button onClick={() => props.onOpenArchivePath(restoreResult.sourceArchive.path)}>Open Archive</button>
                  <button onClick={() => props.onOpenPatient(restoreResult.patientId)}>Open Patient</button>
                  <button className="primary" onClick={() => props.onAddCourse(restoreResult.patientId)}>Start New Course</button>
                </>
              ) : null}
              <button onClick={props.onDismissRestoreResult}>Dismiss</button>
            </div>
          </div>
          <ArchivePathSummary
            fileLabel="Archive source"
            fileName={restoreResult.sourceArchive.fileName}
            pathLabel="Source path"
            pathValue={restoreResult.sourceArchive.path}
          />
          <ArchiveCountSummary
            title="Restore summary"
            lines={[
              `Patient record: ${restoreResult.patientId}`,
              `Courses restored: ${restoreResult.restoredCounts?.courses ?? 0}`,
              `Sites restored: ${restoreResult.restoredCounts?.sites ?? 0}`,
              `Visit notes restored: ${restoreResult.restoredCounts?.visitNotes ?? 0}`,
              `Visit photos restored: ${restoreResult.restoredCounts?.visitPhotos ?? 0}`,
              `Visit attachments restored: ${restoreResult.restoredCounts?.visitAttachments ?? 0}`,
              `Generated PDFs restored: ${restoreResult.restoredCounts?.generatedPdfs ?? 0}`,
              `Asset files restored: ${restoreResult.restoredCounts?.restoredAssets ?? 0}`
            ]}
            marginBottom={restoreResult.blockers.length || restoreResult.notices.length ? "0.8rem" : "0"}
          />
          {restoreResult.restoredCounts ? (
            null
          ) : null}
          {restoreResult.blockers.length ? (
            <div style={{ marginBottom: restoreResult.notices.length ? "0.8rem" : 0 }}>
              <strong>Blocked because:</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {restoreResult.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.relatedId || blocker.entryPath || index}`}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {restoreResult.notices.length ? (
            <div>
              <strong>{restoreResult.status === "restored" ? "Restore notes:" : "Details:"}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                {restoreResult.notices.map((notice, index) => (
                  <li key={`${notice}-${index}`}>{notice}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <input className="search" placeholder="Search patient, MRN, or course" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="completed"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestoreArchivedPatient}
      />
      <div className="patient-list">
        {patients.map((detail) => {
          const completedCourses = detail.courses.filter((cd) => cd.course.status === "completed");
          return (
            <article className="patient-row-card patient-row-grouped" key={detail.patient.id}>
              <div className="patient-row-grouped-header">
                <PatientAvatar appClient={props.appClient} asset={detail.patient.facePhoto} />
                <div className="patient-row-identity">
                  <div className="patient-row-name">{patientDisplayName(detail.patient)}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>MRN {detail.patient.mrn} · DOB {formatDisplayDate(detail.patient.dob)}</div>
                </div>
                <div className="patient-row-actions">
                  <button onClick={() => props.onOpenPatient(detail.patient.id)}>Open Patient</button>
                  <button onClick={() => props.onExportArchive(detail.patient.id)} disabled={props.archiveExportBusyPatientId === detail.patient.id}>
                    {props.archiveExportBusyPatientId === detail.patient.id ? "Exporting..." : "Export Archive"}
                  </button>
                  <button className="primary" onClick={() => props.onAddCourse(detail.patient.id)}>Add Course</button>
                </div>
              </div>
              {completedCourses.map((courseDetail) => (
                <div className="patient-row-course-sub" key={courseDetail.course.id}>
                  <div className="patient-row-course">
                    <div className="strong" style={{ fontSize: "0.92rem" }}>{courseDetail.course.courseName}</div>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {courseDetail.sites.map((s) => s.bodyLocation).filter(Boolean).join(" + ")}
                      {courseDetail.course.endDate ? ` · completed ${formatDisplayDate(courseDetail.course.endDate)}` : ""}
                    </div>
                  </div>
                  <div className="patient-row-actions">
                    {courseDetail.visits.slice(-1).map((v) => (
                      <button key={v.note.id} onClick={() => props.onOpenVisit(courseDetail.course.id, v.note.id)}>Last Note</button>
                    ))}
                    {courseDetail.visits.slice(-1).flatMap((v) => v.pdfs.slice(-1)).map((pdf) => (
                      <button key={pdf.id} onClick={() => props.onOpenPdf(pdf.fileAsset)}>Open PDF</button>
                    ))}
                  </div>
                </div>
              ))}
            </article>
          );
        })}
        {patients.length === 0 ? <p className="muted">No completed courses yet.</p> : null}
      </div>
    </section>
  );
}

export function ArchiveScreen(props: {
  appClient: AppClient | null;
  archive: ArchiveSnapshot | null;
  dashboard: DashboardSnapshot | null;
  completed: ArchiveSnapshot | null;
  search: string;
  onSearchChange: (value: string) => void;
  onRestore: (patientId: string) => void;
  onPermanentlyDeletePatient: (patientId: string) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const patients = (props.archive?.patients || []).filter((detail) =>
    matchesSearch(
      `${patientDisplayName(detail.patient)} ${detail.patient.mrn} ${detail.courses.map((course) => course.course.courseName).join(" ")}`,
      props.search
    )
  );

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Archive</h2>
          <p>Archived patients and their records. Restore to return to the active workflow, or permanently delete to remove all data.</p>
        </div>
      </div>
      <input className="search" placeholder="Search archived patients or courses" value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} />
      <CrossLocationSearchResults
        appClient={props.appClient}
        search={props.search}
        currentSection="archive"
        dashboard={props.dashboard}
        completed={props.completed}
        archive={props.archive}
        onOpenPatient={props.onOpenPatient}
        onRestoreArchivedPatient={props.onRestore}
      />
      <div className="patient-list">
        {patients.map((detail) => (
          <article className="panel" key={detail.patient.id} style={{ borderRadius: "10px" }}>
            <div className="section-header">
              <div>
                <strong>{patientDisplayName(detail.patient)}</strong>
                <span className="muted" style={{ marginLeft: "0.75rem", fontSize: "0.88rem" }}>MRN {detail.patient.mrn} · {detail.patient.status}</span>
              </div>
              <div className="button-row">
                <button onClick={() => props.onRestore(detail.patient.id)}>Restore</button>
                <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => {
                  if (window.confirm(`Permanently delete ${patientDisplayName(detail.patient)} and all their records? This cannot be undone.`)) {
                    props.onPermanentlyDeletePatient(detail.patient.id);
                  }
                }}>Permanently Delete</button>
              </div>
            </div>
            {detail.courses.map((courseDetail) => (
              <div className="visit-row" key={courseDetail.course.id}>
                <div>
                  <strong>{courseDetail.course.courseName}</strong>
                  <span className="muted" style={{ marginLeft: "0.6rem", fontSize: "0.85rem" }}>{courseDetail.course.status}</span>
                </div>
              </div>
            ))}
          </article>
        ))}
        {patients.length === 0 ? <p className="muted">No archived patients.</p> : null}
      </div>
    </section>
  );
}

export function SettingsScreen(props: {
  appClient: AppClient | null;
  settingsPayload: SettingsPayload;
  defaultLogoSrc: string;
  changePin: { currentPin: string; nextPin: string; confirmPin: string };
  onSettingsChange: (settings: SettingsPayload["settings"]) => void;
  onChangePin: (next: { currentPin: string; nextPin: string; confirmPin: string }) => void;
  onSave: () => void;
  onSubmitPin: () => void;
  onLogoSelected: (file: File | undefined) => void;
  onRemoveLogo: () => void;
}) {
  const resolvedLogoSrc = useResolvedAssetUrl(props.appClient, props.settingsPayload.settings.dermatologyOfficeLogoAsset);
  const currentLogoSrc = props.settingsPayload.settings.dermatologyOfficeLogoUpload?.dataUrl
    || resolvedLogoSrc
    || props.defaultLogoSrc;
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Settings</h2>
          <p>Branding, note defaults, and PIN maintenance.</p>
        </div>
        <button className="primary" onClick={props.onSave}>
          Save Settings
        </button>
      </div>
      <div className="settings-grid">
        <div className="panel">
          <label>
            Default Therapist
            <input value={props.settingsPayload.settings.defaultTherapist} onChange={(event) => props.onSettingsChange({ ...props.settingsPayload.settings, defaultTherapist: event.target.value })} />
          </label>
          <label>
            Supervising Physician Name
            <input placeholder="e.g. David S. Sax, M.D." value={props.settingsPayload.settings.supervisingPhysician} onChange={(event) => props.onSettingsChange({ ...props.settingsPayload.settings, supervisingPhysician: event.target.value })} />
          </label>
          <label>
            Dermatology Office Name
            <input placeholder="e.g. Dermatherapy" value={props.settingsPayload.settings.dermatologyOfficeName} onChange={(event) => props.onSettingsChange({ ...props.settingsPayload.settings, dermatologyOfficeName: event.target.value })} />
          </label>
          <div className="logo-settings">
            <span className="strong">Dermatology Office Logo</span>
            <img className="settings-logo-preview" src={currentLogoSrc} alt="Dermatology office logo preview" />
            <div className="button-row">
              <label className="logo-upload-button">
                Upload Logo
                <input type="file" accept="image/*" onChange={(event) => props.onLogoSelected(event.target.files?.[0])} />
              </label>
              <button onClick={props.onRemoveLogo}>Use Default Logo</button>
            </div>
          </div>
        </div>
        <div className="panel">
          <h3>Change PIN</h3>
          <input type="password" inputMode="numeric" placeholder="Current PIN" value={props.changePin.currentPin} onChange={(event) => props.onChangePin({ ...props.changePin, currentPin: event.target.value })} />
          <input type="password" inputMode="numeric" placeholder="New PIN" value={props.changePin.nextPin} onChange={(event) => props.onChangePin({ ...props.changePin, nextPin: event.target.value })} />
          <input type="password" inputMode="numeric" placeholder="Confirm New PIN" value={props.changePin.confirmPin} onChange={(event) => props.onChangePin({ ...props.changePin, confirmPin: event.target.value })} />
          <button onClick={props.onSubmitPin}>Update PIN</button>
        </div>
      </div>
    </section>
  );
}

export function TemplatesScreen(props: {
  templates: TemplateDefinitionRecord[];
  selectedTemplateId: string;
  templateDraft: string;
  onSelectTemplate: (template: TemplateDefinitionRecord) => void;
  onTemplateDraftChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>Template Manager</h2>
          <p>Edit wording safely while keeping supported placeholders visible for each note family.</p>
        </div>
        <div className="button-row">
          <button onClick={props.onReset}>Reset to Default</button>
          <button className="primary" onClick={props.onSave}>
            Save Template
          </button>
        </div>
      </div>
      <div className="editor-layout">
        <div className="panel template-list">
          {props.templates.map((template) => (
            <button key={template.id} className={template.id === props.selectedTemplateId ? "nav active" : "nav"} onClick={() => props.onSelectTemplate(template)}>
              {template.key}
            </button>
          ))}
        </div>
        <div className="panel note-panel">
          <textarea className="template-textarea" value={props.templateDraft} onChange={(event) => props.onTemplateDraftChange(event.target.value)} />
        </div>
        <div className="panel template-side">
          <h3>Available Placeholders</h3>
          <div className="placeholder-list">
            {TEMPLATE_PLACEHOLDERS.map((placeholder) => (
              <div key={placeholder.token} className="placeholder">
                <strong>{`{{${placeholder.token}}}`}</strong>
                <span>{placeholder.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

