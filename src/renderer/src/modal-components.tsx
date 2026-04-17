import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ADDITIONAL_DEVICE_OPTIONS,
  DEVICE_OPTIONS,
  EYE_SHIELD_TYPE_OPTIONS,
  GUM_SHIELD_POSITION_OPTIONS,
  LIP_SHIELD_POSITION_OPTIONS,
  VAC_LOK_AREA_OPTIONS,
  WORKSHEET_POSITION_OPTIONS,
  WORKSHEET_SIDE_OPTIONS,
  formatAdditionalDevices,
  formatWorksheetSelection,
  getAutoNumberOfBlocks,
  normalizeVacLokAreaValue,
  normalizeWorksheetDetailValue,
  normalizeCutoutSizeLabel,
  normalizeWorksheetDeviceDetailsForSite,
  parseAdditionalDevices,
  parseWorksheetSelection
} from "../../shared/note-rules";
import type {
  ConsentSigningInput,
  CourseInput,
  DocumentOnlyInput,
  PatientInput,
  PatientRecord,
  TreatmentCourseRecord,
  TreatmentSiteRecord
} from "../../shared/types";

const FRACTION_PRESETS = [8, 10, 12, 15];
const DAILY_DOSE_PRESETS = [350, 400, 500];
const TOTAL_DOSE_PRESETS = [4000, 4200];
const DEPTH_OPTIONS = ["3", "4", "5"];
const DIAGNOSIS_OPTIONS = [
  "Basal Cell Carcinoma",
  "Squamous Cell Carcinoma",
  "Squamous Cell Carcinoma in-situ"
] as const;

const CONSENT_REVIEW_SECTIONS = [
  {
    title: "Permission Granted:",
    body:
      "I agree to undergo radiation therapy for the treatment of my skin cancer. I am aware of alternative medical and surgical treatments, as well as the risks and benefits of radiation therapy."
  },
  {
    title: "Acknowledgment Necessity to Complete Course of Treatment:",
    body:
      "I understand that the effectiveness and potential cure rate of my prescribed radiation treatment depends on my full participation in the treatment plan. This includes attending all scheduled appointments and receiving each required dose of radiation as prescribed by my provider. I acknowledge that missed or delayed treatments may reduce the likelihood of achieving the intended therapeutic outcome."
  },
  {
    title: "Immobilization and Photographs:",
    body:
      "The use of photographs for treatment purposes has been explained to me. I give permission, as part of my treatment, to have photographs taken as needed. Treatments may require the use of temporary immobilization. I give permission to use such devices as needed."
  },
  {
    title: "Risks & Complications Explained:",
    body:
      "I have been made aware of risks, such as but not limited to redness, dryness, peeling of skin, possible bleeding, risks of infection, scarring, radiation dermatitis, prolonged wound healing, nerve injury, inability to clear the tumor, possible permanent hypo/hyper pigmentation, telangiectasia, and possible permanent hair loss in immediate treatment area. I have been informed there is a remote possibility of secondary cancers developing in the treated area in the future."
  },
  {
    title: "No Guarantee:",
    body:
      "I acknowledge that no guarantee of complete success has been made to me concerning the result intended from the therapy."
  },
  {
    title: "Understanding This Form:",
    body:
      "I confirm that I have read and fully understand this form and that all blank spaces have been completed or crossed off prior to my signing. I have been given an opportunity to ask questions, and all my questions have been answered fully and to my satisfaction."
  }
] as const;

function normalizeIcd10Input(value: string) {
  const trimmedStart = value.replace(/^\s+/, "");
  if (!trimmedStart) {
    return "";
  }

  return `${trimmedStart.charAt(0).toUpperCase()}${trimmedStart.slice(1)}`;
}

function normalizeMeasurementInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const mmMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    return `${mmMatch[1]}mm`;
  }

  const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}mm`;
  }

  return normalized;
}

function ensureTherapistCredentials(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return /RT\(T\)\s*$/i.test(normalized) ? normalized : `${normalized} RT(T)`;
}

function selectValue(value: number, presets: number[]): string {
  return presets.includes(value) ? String(value) : "other";
}

export function PatientModal(props: {
  patientForm: PatientInput;
  busy: boolean;
  onChange: (next: PatientInput) => void;
  onClose: () => void;
  onSave: () => void;
  onFacePhotoSelected: (file: File | undefined) => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>{props.patientForm.id ? "Edit Patient" : "Add Patient"}</h3>
          <div className="form-grid patient-form-grid">
          <label>
            First Name
            <input value={props.patientForm.firstName} onChange={(event) => props.onChange({ ...props.patientForm, firstName: event.target.value })} />
          </label>
          <label>
            Last Name
            <input value={props.patientForm.lastName} onChange={(event) => props.onChange({ ...props.patientForm, lastName: event.target.value })} />
          </label>
          <label>
            MRN
            <input value={props.patientForm.mrn} onChange={(event) => props.onChange({ ...props.patientForm, mrn: event.target.value })} />
          </label>
          <label>
            DOB
            <input type="date" value={props.patientForm.dob} onChange={(event) => props.onChange({ ...props.patientForm, dob: event.target.value })} />
          </label>
            <label>
              Sex
              <select value={props.patientForm.sex ?? ""} onChange={(event) => props.onChange({ ...props.patientForm, sex: event.target.value })}>
                <option value="">Select Sex</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          </div>
          {props.patientForm.id ? (
            <label className="file-picker">
              Face Photo
              <input type="file" accept="image/*" onChange={(event) => props.onFacePhotoSelected(event.target.files?.[0])} />
            </label>
          ) : null}
          <div className="button-row">
            <button onClick={props.onClose}>Cancel</button>
            <button className="primary" disabled={props.busy} onClick={props.onSave}>
              Save Patient
            </button>
        </div>
      </div>
    </div>
  );
}

function SignaturePad(props: {
  value: string;
  onChange: (next: string) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const boundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const movedRef = useRef(false);
  const suppressExternalSyncRef = useRef(false);

  useEffect(() => {
    if (suppressExternalSyncRef.current) {
      suppressExternalSyncRef.current = false;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    boundsRef.current = null;

    if (!props.value) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      const scale = Math.min((canvas.width - 24) / image.width, (canvas.height - 24) / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;
      context.drawImage(image, x, y, width, height);
    };
    image.src = props.value;
  }, [props.value]);

  function updateBounds(x: number, y: number) {
    const current = boundsRef.current;
    if (!current) {
      boundsRef.current = { minX: x, minY: y, maxX: x, maxY: y };
      return;
    }

    current.minX = Math.min(current.minX, x);
    current.minY = Math.min(current.minY, y);
    current.maxX = Math.max(current.maxX, x);
    current.maxY = Math.max(current.maxY, y);
  }

  function exportSignature() {
    const canvas = canvasRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !bounds) {
      return "";
    }

    const padding = 18;
    const cropX = Math.max(0, Math.floor(bounds.minX - padding));
    const cropY = Math.max(0, Math.floor(bounds.minY - padding));
    const cropWidth = Math.min(canvas.width - cropX, Math.ceil(bounds.maxX - bounds.minX + padding * 2));
    const cropHeight = Math.min(canvas.height - cropY, Math.ceil(bounds.maxY - bounds.minY + padding * 2));
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = Math.max(1, cropWidth);
    exportCanvas.height = Math.max(1, cropHeight);
    const exportContext = exportCanvas.getContext("2d");
    if (!exportContext) {
      return "";
    }

    exportContext.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportContext.drawImage(
      canvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      exportCanvas.width,
      exportCanvas.height
    );

    return exportCanvas.toDataURL("image/png");
  }

  function getPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function startDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    drawingRef.current = true;
    movedRef.current = false;
    const point = getPoint(event);
    context.strokeStyle = "#17324a";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(point.x, point.y);
    updateBounds(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  }

  function continueDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!drawingRef.current || !canvas || !context) {
      return;
    }

    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    movedRef.current = true;
    updateBounds(point.x, point.y);
  }

  function stopDrawing(event?: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!drawingRef.current || !canvas || !context) {
      return;
    }

    if (!movedRef.current) {
      const point = event ? getPoint(event) : { x: canvas.width / 2, y: canvas.height / 2 };
      context.beginPath();
      context.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
      context.fillStyle = "#17324a";
      context.fill();
      updateBounds(point.x - 2, point.y - 2);
      updateBounds(point.x + 2, point.y + 2);
    }

    drawingRef.current = false;
    if (event) {
      canvas.releasePointerCapture(event.pointerId);
    }
    suppressExternalSyncRef.current = true;
    props.onChange(exportSignature());
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    boundsRef.current = null;
    suppressExternalSyncRef.current = true;
    props.onChange("");
  }

  return (
    <div className="signature-pad-shell">
      <canvas
        ref={canvasRef}
        className="signature-pad"
        width={520}
        height={props.height ?? 150}
        onPointerDown={startDrawing}
        onPointerMove={continueDrawing}
        onPointerUp={stopDrawing}
        onPointerLeave={(event) => stopDrawing(event)}
      />
      <div className="signature-pad-actions">
        <button type="button" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}

export function ConsentSigningModal(props: {
  patient: PatientRecord;
  course: TreatmentCourseRecord;
  sites: TreatmentSiteRecord[];
  signingInput: ConsentSigningInput;
  busy: boolean;
  onChange: (next: ConsentSigningInput) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const isFemalePatient = props.patient.sex.trim().toLowerCase() === "female";
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [showSignatureStep, setShowSignatureStep] = useState(false);
  const canSave =
    props.signingInput.patientPrintedName.trim().length > 0 &&
    (!isFemalePatient || props.signingInput.patientInitials.trim().length > 0) &&
    props.signingInput.formerRadiationAcknowledged &&
    props.signingInput.medicalDevicesAcknowledged &&
    props.signingInput.witnessPrintedName.trim().length > 0 &&
    Boolean(props.signingInput.patientSignatureDataUrl) &&
    Boolean(props.signingInput.witnessSignatureDataUrl);

  return (
    <div className="modal-backdrop">
      <div className="modal-card wide consent-signing-modal">
        <h3>{showSignatureStep ? "Sign Consent Form" : "Review Consent Form"}</h3>
        {!showSignatureStep ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Review the full consent wording with the patient before moving into the signature step.
            </p>
            <div className="site-grid">
              <div className="subpanel">
                <h4>{props.patient.lastName}, {props.patient.firstName}</h4>
                <p>MRN {props.patient.mrn} · DOB {props.patient.dob}</p>
                <p>{props.course.courseType === "one_site" ? "1-lesion course" : "2-lesion course"}</p>
              </div>
              <div className="subpanel">
                <h4>Sites</h4>
                {props.sites
                  .slice()
                  .sort((left, right) => left.siteNumber - right.siteNumber)
                  .map((site) => (
                    <p key={site.id}>
                      Lesion {site.siteNumber}: {site.treatmentLocationText || site.bodyLocation || "Pending site"} · {site.diagnosisText || "Pending diagnosis"}
                    </p>
                  ))}
              </div>
            </div>
            <div className="subpanel consent-review-copy">
              {CONSENT_REVIEW_SECTIONS.map((section) => (
                <p key={section.title}>
                  <strong>{section.title}</strong> {section.body}
                </p>
              ))}
            </div>
            <div className="subpanel">
              <label className="checkbox-option consent-review-confirm">
                <input
                  type="checkbox"
                  checked={reviewAcknowledged}
                  onChange={(event) => setReviewAcknowledged(event.target.checked)}
                />
                <span className="checkbox-option-label">
                  I have reviewed this consent form with the patient and am ready to proceed to signatures.
                </span>
              </label>
            </div>
            <div className="button-row">
              <button onClick={props.onClose}>Cancel</button>
              <button className="primary" disabled={!reviewAcknowledged} onClick={() => setShowSignatureStep(true)}>
                Continue To Signature
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Collect initials and signatures inside the app, then finalize the signed consent PDF.
            </p>
            <div className="site-grid">
              <div className="subpanel">
                <h4>{props.patient.lastName}, {props.patient.firstName}</h4>
                <p>MRN {props.patient.mrn} · DOB {props.patient.dob}</p>
                <p>{props.course.courseType === "one_site" ? "1-lesion course" : "2-lesion course"}</p>
              </div>
              <div className="subpanel">
                <h4>Sites</h4>
                {props.sites
                  .slice()
                  .sort((left, right) => left.siteNumber - right.siteNumber)
                  .map((site) => (
                    <p key={site.id}>
                      Lesion {site.siteNumber}: {site.treatmentLocationText || site.bodyLocation || "Pending site"} · {site.diagnosisText || "Pending diagnosis"}
                    </p>
                  ))}
              </div>
            </div>
            <div className="form-grid consent-signing-grid">
              <label>
                Sign Date
                <input
                  type="date"
                  value={props.signingInput.signDate}
                  onChange={(event) => props.onChange({ ...props.signingInput, signDate: event.target.value })}
                />
              </label>
              <label>
                Patient Printed Name
                <input
                  value={props.signingInput.patientPrintedName}
                  onChange={(event) => props.onChange({ ...props.signingInput, patientPrintedName: event.target.value })}
                />
              </label>
              <label>
                Witness Name
                <input
              value={props.signingInput.witnessPrintedName}
              onChange={(event) => props.onChange({ ...props.signingInput, witnessPrintedName: event.target.value })}
              onBlur={(event) =>
                props.onChange({
                  ...props.signingInput,
                  witnessPrintedName: ensureTherapistCredentials(event.target.value)
                })
              }
            />
          </label>
            </div>
            {isFemalePatient ? (
              <div className="subpanel">
                <h4>Female Pregnancy Statement</h4>
                <div className="consent-pregnancy-grid">
                  <p className="checkbox-option-label" style={{ margin: 0 }}>
                    Females: Regarding Possibility of Pregnancy: This is to certify that, to the best of my knowledge, I am not pregnant, I have been advised that procedures involving x-rays, particularly those involving the pelvis, can be hazardous to an unborn child.
                  </p>
                  <label>
                    Initials
                    <input
                      value={props.signingInput.patientInitials}
                      onChange={(event) => props.onChange({ ...props.signingInput, patientInitials: event.target.value.toUpperCase() })}
                    />
                  </label>
                </div>
              </div>
            ) : null}
            <div className="subpanel">
              <h4>Patient Acknowledgment</h4>
              <div className="consent-acknowledgment-list">
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={props.signingInput.formerRadiationAcknowledged}
                    onChange={(event) =>
                      props.onChange({ ...props.signingInput, formerRadiationAcknowledged: event.target.checked })
                    }
                  />
                  <span className="checkbox-option-label">
                    I have informed this provider about any former therapeutic radiation I have received in the past.
                  </span>
                </label>
                <label className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={props.signingInput.medicalDevicesAcknowledged}
                    onChange={(event) =>
                      props.onChange({ ...props.signingInput, medicalDevicesAcknowledged: event.target.checked })
                    }
                  />
                  <span className="checkbox-option-label">
                    I have informed this provider about any medical devices in or near the treatment area.
                  </span>
                </label>
              </div>
            </div>
            <div className="site-grid">
              <div className="subpanel">
                <h4>Patient Signature</h4>
                <SignaturePad
                  value={props.signingInput.patientSignatureDataUrl}
                  onChange={(next) => props.onChange({ ...props.signingInput, patientSignatureDataUrl: next })}
                />
              </div>
              <div className="subpanel">
                <h4>Witness Signature</h4>
                <SignaturePad
                  value={props.signingInput.witnessSignatureDataUrl}
                  onChange={(next) => props.onChange({ ...props.signingInput, witnessSignatureDataUrl: next })}
                />
              </div>
            </div>
            <div className="button-row">
              <button onClick={props.onClose}>Cancel</button>
              <button onClick={() => setShowSignatureStep(false)}>Back To Consent Text</button>
              <button className="primary" disabled={props.busy || !canSave} onClick={props.onSave}>
                Finalize Consent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function buildIntakeCourseName(sites: CourseInput["sites"]) {
  return sites.map((site) => site.treatmentLocationText.trim()).filter(Boolean).join(" + ");
}

function createIntakeSite(siteNumber: 1 | 2, source?: CourseInput["sites"][number]): CourseInput["sites"][number] {
  return {
    ...(source ?? {
      bodyLocation: "",
      treatmentLocationText: "",
      diagnosisText: "",
      icd10: "",
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
      dailyDose: 400,
      totalDose: 4000
    }),
    id: source?.id,
    siteNumber,
    bodyLocation: source?.bodyLocation ?? "",
    treatmentLocationText: source?.treatmentLocationText ?? "",
    diagnosisText: source?.diagnosisText ?? "",
    icd10: source?.icd10 ?? ""
  };
}

function createDocumentOnlySite(siteNumber: 1 | 2, source?: DocumentOnlyInput["sites"][number]): DocumentOnlyInput["sites"][number] {
  return {
    ...(source ?? {
      bodyLocation: "",
      treatmentLocationText: "",
      diagnosisText: "",
      icd10: "",
      numberOfBlocks: 1,
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
      dailyDose: 400,
      totalDose: 4000,
      projectedFractions: null
    }),
    id: source?.id,
    siteNumber,
    bodyLocation: source?.bodyLocation ?? "",
    treatmentLocationText: source?.treatmentLocationText ?? "",
    diagnosisText: source?.diagnosisText ?? "",
    icd10: source?.icd10 ?? ""
  };
}

export function PendingCourseIntakeModal(props: {
  courseForm: CourseInput;
  busy: boolean;
  onChange: (next: CourseInput) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const courseForm = props.courseForm;
  const isTwoSite = courseForm.courseType === "two_site";

  function updateSites(nextSites: CourseInput["sites"]) {
    props.onChange({
      ...courseForm,
      courseName: buildIntakeCourseName(nextSites),
      sites: nextSites
    });
  }

  function updateSite(index: number, patch: Partial<CourseInput["sites"][0]>) {
    const nextSites = courseForm.sites.map((site, siteIndex) =>
      siteIndex === index
        ? {
            ...site,
            ...patch,
            bodyLocation: patch.treatmentLocationText ?? patch.bodyLocation ?? site.bodyLocation,
            treatmentLocationText: patch.treatmentLocationText ?? patch.bodyLocation ?? site.treatmentLocationText
          }
        : site
    );
    updateSites(nextSites);
  }

  return (
    <div className="modal-backdrop">
      <div className={`modal-card pending-course-modal${isTwoSite ? " wide" : ""}`}>
        <h3>{courseForm.id ? "Edit Consent / Path Intake" : "New Consent / Path Intake"}</h3>
        <div className="pending-course-intro">
          <p className="muted">
            Start the course with the pathology details we already know. Full treatment setup can be completed after the sim / consult.
          </p>
          <p className="muted">
            Projected Fractions are an estimate for the Sim Worksheet and can be changed on the 1st treatment to the Final Prescribed Fractions.
          </p>
        </div>
          <div className="form-grid course-top-grid">
            <label>
              Number of Lesions
            <select
              value={courseForm.courseType}
              onChange={(event) => {
                const nextType = event.target.value as CourseInput["courseType"];
                const nextSites =
                  nextType === "two_site"
                    ? [
                        createIntakeSite(1, courseForm.sites[0]),
                        createIntakeSite(2, courseForm.sites[1])
                      ]
                    : [createIntakeSite(1, courseForm.sites[0])];
                props.onChange({
                  ...courseForm,
                  courseType: nextType,
                  courseName: buildIntakeCourseName(nextSites),
                  sites: nextSites
                });
              }}
            >
              <option value="one_site">1 Lesion</option>
              <option value="two_site">2 Lesions</option>
            </select>
            </label>
            <label>
              Biopsy Date
              <input
                type="date"
                value={courseForm.startDate}
                onChange={(event) => props.onChange({ ...courseForm, startDate: event.target.value })}
              />
            </label>
            <label>
              Sim / Consult Date
              <input
                type="date"
                value={courseForm.simConsultDate ?? ""}
                onChange={(event) => props.onChange({ ...courseForm, simConsultDate: event.target.value })}
              />
            </label>
          </div>
        <div className={`site-grid${isTwoSite ? " two-site-course-grid" : ""}`}>
          {courseForm.sites.map((site, index) => (
            <div className="subpanel" key={site.siteNumber}>
              <h4>{isTwoSite ? `Lesion ${site.siteNumber}` : "Lesion"}</h4>
          <div className="form-grid course-top-grid">
                <label>
                  Treatment Lesion
                  <input
                    placeholder="Treatment location"
                    value={site.treatmentLocationText}
                    onChange={(event) => updateSite(index, { treatmentLocationText: event.target.value, bodyLocation: event.target.value })}
                  />
                </label>
                <label>
                  Diagnosis
                  <select
                    value={site.diagnosisText}
                    onChange={(event) => updateSite(index, { diagnosisText: event.target.value })}
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
                    onChange={(event) => updateSite(index, { icd10: normalizeIcd10Input(event.target.value) })}
                  />
                </label>
                <label>
                  {isTwoSite ? `Projected Fractions Lesion ${site.siteNumber}` : "Projected Fractions"}
                  <input
                    type="number"
                    min={1}
                    max={15}
                    placeholder="e.g. 10"
                    value={site.prescribedFractions ?? ""}
                    onChange={(event) =>
                      updateSite(index, {
                        prescribedFractions: event.target.value ? Number(event.target.value) : undefined
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button onClick={props.onClose}>Cancel</button>
          {props.onDelete && courseForm.id ? (
            <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={props.onDelete}>
              Remove Intake
            </button>
          ) : null}
          <button className="primary" disabled={props.busy} onClick={props.onSave}>
            Save Intake
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentOnlyRecordModal(props: {
  recordForm: DocumentOnlyInput;
  busy: boolean;
  onChange: (next: DocumentOnlyInput) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const recordForm = props.recordForm;
  const isTwoSite = recordForm.courseType === "two_site";

  function updateSite(index: number, patch: Partial<DocumentOnlyInput["sites"][0]>) {
    props.onChange({
      ...recordForm,
      sites: recordForm.sites.map((site, siteIndex) =>
        siteIndex === index
          ? {
              ...site,
              ...patch,
              bodyLocation: patch.treatmentLocationText ?? patch.bodyLocation ?? site.bodyLocation,
              treatmentLocationText: patch.treatmentLocationText ?? patch.bodyLocation ?? site.treatmentLocationText
            }
          : site
      )
    });
  }

  return (
    <div className="modal-backdrop">
      <div className={`modal-card wide${isTwoSite ? " two-site-course-modal" : ""}`}>
        <h3>{recordForm.id ? "Edit Document Record" : "New Document Record"}</h3>
        <div className="pending-course-intro">
          <p className="muted">
            Capture only the information needed for consent now. Additional worksheet setup will be collected later when you generate the Sim Worksheet.
          </p>
        </div>
        <div className="form-grid">
          <label>
            First Name
            <input value={recordForm.firstName} onChange={(event) => props.onChange({ ...recordForm, firstName: event.target.value })} />
          </label>
          <label>
            Last Name
            <input value={recordForm.lastName} onChange={(event) => props.onChange({ ...recordForm, lastName: event.target.value })} />
          </label>
          <label>
            MRN
            <input value={recordForm.mrn} onChange={(event) => props.onChange({ ...recordForm, mrn: event.target.value })} />
          </label>
          <label>
            DOB
            <input type="date" value={recordForm.dob} onChange={(event) => props.onChange({ ...recordForm, dob: event.target.value })} />
          </label>
          <label>
            Sex
            <select value={recordForm.sex} onChange={(event) => props.onChange({ ...recordForm, sex: event.target.value })}>
              <option value="">Select Sex</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </label>
          <label>
            Number of Lesions
            <select
              value={recordForm.courseType}
              onChange={(event) => {
                const nextType = event.target.value as DocumentOnlyInput["courseType"];
                props.onChange({
                  ...recordForm,
                  courseType: nextType,
                  sites:
                    nextType === "two_site"
                      ? [createDocumentOnlySite(1, recordForm.sites[0]), createDocumentOnlySite(2, recordForm.sites[1])]
                      : [createDocumentOnlySite(1, recordForm.sites[0])]
                });
              }}
            >
              <option value="one_site">1 Lesion</option>
              <option value="two_site">2 Lesions</option>
            </select>
          </label>
          <label>
            Sim / Consult Date
            <input
              type="date"
              value={recordForm.simConsultDate}
              onChange={(event) => props.onChange({ ...recordForm, simConsultDate: event.target.value })}
            />
          </label>
        </div>
        <div className={`site-grid${isTwoSite ? " two-site-course-grid" : ""}`}>
          {recordForm.sites.map((site, index) => {
            return (
              <div className="subpanel compact-course-subpanel" key={site.siteNumber}>
                <h4>{isTwoSite ? `Lesion ${site.siteNumber}` : "Lesion"}</h4>
                <div className="form-grid course-top-grid">
                  <label>
                    Treatment Lesion
                    <input
                      placeholder="Treatment location"
                      value={site.treatmentLocationText}
                      onChange={(event) =>
                        updateSite(index, { treatmentLocationText: event.target.value, bodyLocation: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Diagnosis
                    <select value={site.diagnosisText} onChange={(event) => updateSite(index, { diagnosisText: event.target.value })}>
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
                      onChange={(event) => updateSite(index, { icd10: normalizeIcd10Input(event.target.value) })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="button-row">
          <button onClick={props.onClose}>Cancel</button>
          {props.onDelete && recordForm.id ? (
            <button style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={props.onDelete}>
              Delete Record
            </button>
          ) : null}
          <button className="primary" disabled={props.busy} onClick={props.onSave}>
            Save Record
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentOnlyWorksheetModal(props: {
  recordForm: DocumentOnlyInput;
  busy: boolean;
  onChange: (next: DocumentOnlyInput) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const recordForm = props.recordForm;
  const isTwoSite = recordForm.courseType === "two_site";
  const [customShieldEnabled, setCustomShieldEnabled] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setCustomShieldEnabled((current) => {
      const next: typeof current = {};
      recordForm.sites.forEach((site, index) => {
        const existingCustomValue = getSelectedDevices(site.additionalDevices).customValue.trim();
        next[index] = current[index] ?? Boolean(existingCustomValue);
      });
      return next;
    });
  }, [recordForm.id, recordForm.sites]);

  function getSelectedDevices(value: string) {
    const parsed = parseAdditionalDevices(value);
    const selected = new Set(parsed);
    const customValues = parsed.filter((device) => !DEVICE_OPTIONS.includes(device));
    return {
      selected,
      customValue: customValues.join(", ")
    };
  }

  function updateSite(index: number, patch: Partial<DocumentOnlyInput["sites"][0]>) {
    props.onChange({
      ...recordForm,
      sites: recordForm.sites.map((site, siteIndex) =>
        siteIndex === index
          ? {
              ...site,
              ...patch,
              bodyLocation: patch.treatmentLocationText ?? patch.bodyLocation ?? site.bodyLocation,
              treatmentLocationText: patch.treatmentLocationText ?? patch.bodyLocation ?? site.treatmentLocationText,
              numberOfBlocks: getAutoNumberOfBlocks("consult_sim", patch.cutoutSize ?? site.cutoutSize)
            }
          : site
      )
    });
  }

  function updateAdditionalDevices(index: number, nextSelected: Set<string>, customValue: string) {
    const nextValues = [
      ...ADDITIONAL_DEVICE_OPTIONS.filter((option) => nextSelected.has(option)),
      ...customValue
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ];

    const site = recordForm.sites[index];
    const normalizedCurrentDetails = normalizeWorksheetDeviceDetailsForSite(site);
    updateSite(index, {
      additionalDevices: nextValues.length ? formatAdditionalDevices(nextValues.join(", ")) : "None",
      worksheetEyeShieldType: nextSelected.has("Eye Shield") ? normalizedCurrentDetails.worksheetEyeShieldType : "",
      worksheetGumShieldPosition: nextSelected.has("Gum Shield") ? normalizedCurrentDetails.worksheetGumShieldPosition : "",
      worksheetLipShieldPosition: nextSelected.has("Lip Shield") ? normalizedCurrentDetails.worksheetLipShieldPosition : ""
    });
  }

  function getWorksheetSelection(value: string) {
    return new Set(parseWorksheetSelection(value));
  }

  function updateWorksheetSelection(index: number, field: "worksheetPositioning" | "worksheetSide", values: string[]) {
    if (field === "worksheetPositioning") {
      const nextSelected = new Set(parseWorksheetSelection(values.join(", ")));
      if (nextSelected.has("Hunched Over Tx Couch")) {
        nextSelected.add("Sitting in Chair");
      }
      if (!nextSelected.has("Sitting in Chair")) {
        nextSelected.delete("Hunched Over Tx Couch");
      }
      const orderedValues = WORKSHEET_POSITION_OPTIONS.filter((option) => nextSelected.has(option));
      const site = recordForm.sites[index];
      updateSite(index, {
        [field]: formatWorksheetSelection(orderedValues),
        worksheetVacLokArea: nextSelected.has("Vac-Lok") ? normalizeVacLokAreaValue(site.worksheetVacLokArea) : ""
      });
      return;
    }

    updateSite(index, { [field]: formatWorksheetSelection(values) });
  }

  return (
    <div className="modal-backdrop">
      <div className={`modal-card wide${isTwoSite ? " two-site-course-modal" : ""}`}>
        <h3>Sim Worksheet Setup</h3>
        <div className="pending-course-intro">
          <p className="muted">
            Add the worksheet-only setup here. Your consent intake stays separate, and these values can be revised later if needed.
          </p>
        </div>
        <div className="form-grid">
          <label>
            Therapist Name
            <input
              value={recordForm.therapistName}
              onChange={(event) => props.onChange({ ...recordForm, therapistName: event.target.value })}
              onBlur={(event) => props.onChange({ ...recordForm, therapistName: ensureTherapistCredentials(event.target.value) })}
            />
          </label>
        </div>
        <div className={`site-grid${isTwoSite ? " two-site-course-grid" : ""}`}>
          {recordForm.sites.map((site, index) => {
            const selectedDevices = getSelectedDevices(site.additionalDevices);
            const worksheetPositioning = getWorksheetSelection(site.worksheetPositioning);
            const worksheetSide = getWorksheetSelection(site.worksheetSide);
            const customShieldValue = selectedDevices.customValue;
            return (
              <div className="subpanel compact-course-subpanel" key={site.siteNumber}>
                <h4>{isTwoSite ? `Lesion ${site.siteNumber}` : "Lesion"}</h4>
                <div className="muted" style={{ fontSize: "0.88rem", marginBottom: "0.45rem", lineHeight: 1.35 }}>
                  <div><strong>Treatment Lesion:</strong> {site.treatmentLocationText || "Not entered yet"}</div>
                  <div><strong>Diagnosis:</strong> {site.diagnosisText || "Not entered yet"}</div>
                  <div><strong>ICD10:</strong> {site.icd10 || "Not entered yet"}</div>
                </div>
                <div className="form-grid course-top-grid">
                  <label>
                    Projected Fractions
                    <input
                      type="number"
                      min={1}
                      max={15}
                      placeholder="e.g. 10"
                      value={site.projectedFractions ?? ""}
                      onChange={(event) =>
                        updateSite(index, { projectedFractions: event.target.value ? Number(event.target.value) : null })
                      }
                    />
                  </label>
                  <label>
                    Cone Size
                    <input
                      placeholder="e.g. 20mm"
                      value={site.coneSize}
                      onChange={(event) => updateSite(index, { coneSize: normalizeMeasurementInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Cutout Size
                    <input
                      placeholder="Open Cone or e.g. 18mm"
                      value={site.cutoutSize}
                      onChange={(event) => updateSite(index, { cutoutSize: normalizeMeasurementInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Lesion Size (mm)
                    <input
                      placeholder="e.g. 10mm"
                      value={site.lesionSize}
                      onChange={(event) => updateSite(index, { lesionSize: normalizeMeasurementInput(event.target.value) })}
                    />
                  </label>
                  <label>
                    Treatment Depth
                    <select value={site.treatmentDepth} onChange={(event) => updateSite(index, { treatmentDepth: event.target.value })}>
                      {DEPTH_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} mm
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="worksheet-setup-grid">
                  <div className="worksheet-section">
                    <h4>Additional Treatment Devices</h4>
                    <div className="checkbox-group compact">
                      {ADDITIONAL_DEVICE_OPTIONS.map((option) => (
                        <label className="checkbox-label" key={option}>
                          <input
                            type="checkbox"
                            checked={selectedDevices.selected.has(option)}
                            onChange={(event) => {
                              const next = new Set(selectedDevices.selected);
                              if (event.target.checked) {
                                next.add(option);
                              } else {
                                next.delete(option);
                              }
                              updateAdditionalDevices(index, next, customShieldEnabled[index] ? customShieldValue : "");
                            }}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={customShieldEnabled[index] ?? Boolean(customShieldValue)}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setCustomShieldEnabled((current) => ({ ...current, [index]: enabled }));
                            updateAdditionalDevices(index, selectedDevices.selected, enabled ? customShieldValue : "");
                          }}
                        />
                        <span>Custom Shield</span>
                      </label>
                    </div>
                    {selectedDevices.selected.has("Eye Shield") ? (
                      <label>
                        Eye Shield Type
                        <select
                          value={normalizeWorksheetDetailValue(site.worksheetEyeShieldType, EYE_SHIELD_TYPE_OPTIONS)}
                          onChange={(event) => updateSite(index, { worksheetEyeShieldType: event.target.value })}
                        >
                          <option value="">Select type</option>
                          {EYE_SHIELD_TYPE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedDevices.selected.has("Gum Shield") ? (
                      <label>
                        Gum Shield Position
                        <select
                          value={normalizeWorksheetDetailValue(site.worksheetGumShieldPosition, GUM_SHIELD_POSITION_OPTIONS)}
                          onChange={(event) => updateSite(index, { worksheetGumShieldPosition: event.target.value })}
                        >
                          <option value="">Select position</option>
                          {GUM_SHIELD_POSITION_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedDevices.selected.has("Lip Shield") ? (
                      <label>
                        Lip Shield Position
                        <select
                          value={normalizeWorksheetDetailValue(site.worksheetLipShieldPosition, LIP_SHIELD_POSITION_OPTIONS)}
                          onChange={(event) => updateSite(index, { worksheetLipShieldPosition: event.target.value })}
                        >
                          <option value="">Select position</option>
                          {LIP_SHIELD_POSITION_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {(customShieldEnabled[index] ?? Boolean(customShieldValue)) ? (
                      <label>
                        Custom Shield
                        <input
                          placeholder="Enter custom shield/device"
                          value={customShieldValue}
                          onChange={(event) => updateAdditionalDevices(index, selectedDevices.selected, event.target.value)}
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="worksheet-section positioning-section">
                    <h4>Positioning</h4>
                    <div className="position-list">
                      {WORKSHEET_POSITION_OPTIONS.map((option) => (
                        <label className="checkbox-option" key={option}>
                          <input
                            type="checkbox"
                            checked={worksheetPositioning.has(option)}
                            onChange={(event) => {
                              const next = new Set(worksheetPositioning);
                              if (event.target.checked) {
                                next.add(option);
                              } else {
                                next.delete(option);
                              }
                              updateWorksheetSelection(index, "worksheetPositioning", [...next]);
                            }}
                          />
                          <span className="checkbox-option-label">{option}</span>
                        </label>
                      ))}
                    </div>
                    {worksheetPositioning.has("Vac-Lok") ? (
                      <label>
                        Vac-Lok Area
                        <select
                          value={normalizeVacLokAreaValue(site.worksheetVacLokArea)}
                          onChange={(event) => updateSite(index, { worksheetVacLokArea: event.target.value })}
                        >
                          <option value="">Select area</option>
                          {VAC_LOK_AREA_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <div className="worksheet-section lesion-side-section">
                    <h4>Lesion Side</h4>
                    <div className="side-list">
                      {WORKSHEET_SIDE_OPTIONS.map((option) => (
                        <label className="checkbox-option" key={option}>
                          <input
                            type="checkbox"
                            checked={worksheetSide.has(option)}
                            onChange={(event) => {
                              const next = new Set(worksheetSide);
                              if (event.target.checked) {
                                next.add(option);
                              } else {
                                next.delete(option);
                              }
                              updateWorksheetSelection(index, "worksheetSide", [...next]);
                            }}
                          />
                          <span className="checkbox-option-label">{option}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="form-grid compact-grid">
                  <label>
                    Daily Dose (cGy)
                    <input
                      type="number"
                      value={site.dailyDose}
                      onChange={(event) => updateSite(index, { dailyDose: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    Total Dose (cGy)
                    <input
                      type="number"
                      value={site.totalDose}
                      onChange={(event) => updateSite(index, { totalDose: Number(event.target.value) || 0 })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="button-row">
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" disabled={props.busy} onClick={props.onSave}>
            Save + Generate Worksheet
          </button>
        </div>
      </div>
    </div>
  );
}

export function CourseConsentModal(props: {
  courseName: string;
  hasConsentForm: boolean;
  busy: boolean;
  onClose: () => void;
  onOpenConsentForm?: () => void;
  onGenerateConsentForm?: () => void;
  onUploadConsentForm?: () => void;
  onDeleteConsentForm?: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>Consent</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Manage the consent form for {props.courseName || "this course"} after treatment setup has been completed.
        </p>
        <div className="subpanel">
          <h4 style={{ marginBottom: "0.6rem" }}>Consent Form</h4>
          <div className="button-row">
            {props.hasConsentForm ? (
              <>
                <button onClick={props.onOpenConsentForm}>Open Consent Form</button>
                <button onClick={props.onGenerateConsentForm}>Re-sign Consent</button>
                <button onClick={props.onUploadConsentForm}>Import Signed Consent</button>
                <button onClick={props.onDeleteConsentForm}>Remove Consent</button>
              </>
            ) : (
              <>
                <button onClick={props.onGenerateConsentForm}>Review / Sign Consent</button>
                <button onClick={props.onUploadConsentForm}>Import Signed Consent</button>
              </>
            )}
          </div>
        </div>
        <div className="button-row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function CourseModal(props: {
  courseForm: CourseInput;
  busy: boolean;
  showFacePhotoPicker?: boolean;
  facePhotoUploadName?: string;
  onChange: (next: CourseInput) => void;
  onClose: () => void;
  onSave: () => void;
  onFacePhotoSelected?: (file: File | undefined) => void;
  onDelete?: () => void;
  }) {
    const courseForm = props.courseForm;
    const [customFractions, setCustomFractions] = useState("");
    const [fractionMode, setFractionMode] = useState<"preset" | "other">("preset");
    const isPendingCourseSetup = courseForm.status === "pending";
    const showFractionsField = Boolean(courseForm.id) && !isPendingCourseSetup;
  const [doseModes, setDoseModes] = useState<Record<number, { dailyDose: "preset" | "other"; totalDose: "preset" | "other" }>>({});
  const [siteFractionModes, setSiteFractionModes] = useState<Record<number, { mode: "preset" | "other"; custom: string }>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [customShieldEnabled, setCustomShieldEnabled] = useState<Record<number, boolean>>({});
  const isTwoSite = courseForm.courseType === "two_site";

  useEffect(() => {
    if (FRACTION_PRESETS.includes(courseForm.prescribedFractions)) {
      setCustomFractions("");
      setFractionMode("preset");
      return;
    }

    setFractionMode("other");
    setCustomFractions(courseForm.prescribedFractions ? String(courseForm.prescribedFractions) : "");
  }, [courseForm.id, courseForm.prescribedFractions]);

  useEffect(() => {
    setDoseModes((current) => {
      const next: typeof current = {};
      courseForm.sites.forEach((site, index) => {
        next[index] = current[index] ?? {
          dailyDose: DAILY_DOSE_PRESETS.includes(site.dailyDose) ? "preset" : "other",
          totalDose: TOTAL_DOSE_PRESETS.includes(site.totalDose) ? "preset" : "other"
        };
      });
      return next;
    });
  }, [courseForm.id, courseForm.sites.length]);

  useEffect(() => {
    setSiteFractionModes((current) => {
      const next: typeof current = {};
      courseForm.sites.forEach((site, index) => {
        const fracs = site.prescribedFractions ?? courseForm.prescribedFractions ?? 0;
        next[index] = current[index] ?? {
          mode: fracs > 0 && !FRACTION_PRESETS.includes(fracs) ? "other" : "preset",
          custom: fracs > 0 && !FRACTION_PRESETS.includes(fracs) ? String(fracs) : ""
        };
      });
      return next;
    });
  }, [courseForm.id, courseForm.sites.length]);

  useEffect(() => {
    setCustomShieldEnabled((current) => {
      const next: typeof current = {};
      courseForm.sites.forEach((site, index) => {
        const existingCustomValue = getSelectedDevices(site.additionalDevices).customValue.trim();
        next[index] = current[index] ?? Boolean(existingCustomValue);
      });
      return next;
    });
  }, [courseForm.id, courseForm.sites]);

  function getSiteFractionMode(index: number): "preset" | "other" {
    const site = courseForm.sites[index];
    const fracs = site.prescribedFractions ?? 0;
    return siteFractionModes[index]?.mode ?? (fracs > 0 && !FRACTION_PRESETS.includes(fracs) ? "other" : "preset");
  }

  function updateSiteFractions(index: number, fracs: number) {
    const newSites = courseForm.sites.map((s, i) => i === index ? { ...s, prescribedFractions: fracs } : s);
    props.onChange({
      ...courseForm,
      sites: newSites,
      prescribedFractions: index === 0 ? fracs : courseForm.prescribedFractions
    });
  }

  function getSelectedDevices(value: string) {
    const parsed = parseAdditionalDevices(value);
    const selected = new Set(parsed);
    const customValues = parsed.filter((device) => !DEVICE_OPTIONS.includes(device));
    return {
      selected,
      customValue: customValues.join(", ")
    };
  }

  function updateAdditionalDevices(index: number, nextSelected: Set<string>, customValue: string) {
    const nextValues = [
      ...ADDITIONAL_DEVICE_OPTIONS.filter((option) => nextSelected.has(option)),
      ...customValue
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ];

    const site = courseForm.sites[index];
    const normalizedCurrentDetails = normalizeWorksheetDeviceDetailsForSite(site);
    updateSite(index, {
      additionalDevices: nextValues.length ? formatAdditionalDevices(nextValues.join(", ")) : "None",
      worksheetEyeShieldType: nextSelected.has("Eye Shield") ? normalizedCurrentDetails.worksheetEyeShieldType : "",
      worksheetGumShieldPosition: nextSelected.has("Gum Shield")
        ? normalizedCurrentDetails.worksheetGumShieldPosition
        : "",
      worksheetLipShieldPosition: nextSelected.has("Lip Shield")
        ? normalizedCurrentDetails.worksheetLipShieldPosition
        : ""
    });
  }

  function getWorksheetSelection(value: string) {
    return new Set(parseWorksheetSelection(value));
  }

  function updateWorksheetSelection(index: number, field: "worksheetPositioning" | "worksheetSide", values: string[]) {
    if (field === "worksheetPositioning") {
      const nextSelected = new Set(parseWorksheetSelection(values.join(", ")));
      if (nextSelected.has("Hunched Over Tx Couch")) {
        nextSelected.add("Sitting in Chair");
      }
      if (!nextSelected.has("Sitting in Chair")) {
        nextSelected.delete("Hunched Over Tx Couch");
      }
      const orderedValues = WORKSHEET_POSITION_OPTIONS.filter((option) => nextSelected.has(option));
      const site = courseForm.sites[index];
        updateSite(index, {
          [field]: formatWorksheetSelection(orderedValues),
        worksheetVacLokArea: nextSelected.has("Vac-Lok") ? normalizeVacLokAreaValue(site.worksheetVacLokArea) : ""
        });
        return;
      }

    updateSite(index, { [field]: formatWorksheetSelection(values) });
  }

  function getDoseMode(index: number, key: "dailyDose" | "totalDose") {
    const site = courseForm.sites[index];
    const presets = key === "dailyDose" ? DAILY_DOSE_PRESETS : TOTAL_DOSE_PRESETS;
    return doseModes[index]?.[key] ?? (presets.includes(site[key]) ? "preset" : "other");
  }

  function setDoseMode(index: number, key: "dailyDose" | "totalDose", value: "preset" | "other") {
    setDoseModes((current) => ({
      ...current,
      [index]: {
        dailyDose: current[index]?.dailyDose ?? (DAILY_DOSE_PRESETS.includes(courseForm.sites[index].dailyDose) ? "preset" : "other"),
        totalDose: current[index]?.totalDose ?? (TOTAL_DOSE_PRESETS.includes(courseForm.sites[index].totalDose) ? "preset" : "other"),
        [key]: value
      }
    }));
  }

  function updateSite(index: number, patch: Partial<CourseInput["sites"][0]>) {
    const nextSite = { ...courseForm.sites[index], ...patch };
    props.onChange({
      ...courseForm,
      sites: courseForm.sites.map((item, i) =>
        i === index
          ? {
              ...nextSite,
              numberOfBlocks: getAutoNumberOfBlocks("standard_treatment", nextSite.cutoutSize)
            }
          : item
      )
    });
  }

      return (
        <div className="modal-backdrop">
        <div className={`modal-card wide${isTwoSite ? " two-site-course-modal" : ""}`}>
          <h3>{isPendingCourseSetup ? "Complete Course Setup" : courseForm.id ? "Edit Course" : "Add Treatment Course"}</h3>
        <div className="form-grid">
          <label>
            Number of Lesions
            <select
              value={courseForm.courseType}
              onChange={(event) => {
                const next = event.target.value as CourseInput["courseType"];
                props.onChange({
                  ...courseForm,
                  courseType: next,
                  sites: next === "two_site"
                    ? courseForm.sites.length === 2 ? courseForm.sites : [...courseForm.sites, { ...courseForm.sites[0], siteNumber: 2 }]
                    : [courseForm.sites[0]]
                });
              }}
            >
              <option value="one_site">1 Lesion</option>
              <option value="two_site">2 Lesions</option>
            </select>
          </label>
          {showFractionsField && !isTwoSite ? <label>
            Prescribed Fractions
            <select
              value={fractionMode === "other" ? "other" : selectValue(courseForm.prescribedFractions, FRACTION_PRESETS)}
              onChange={(event) => {
                if (event.target.value === "other") {
                  setFractionMode("other");
                  setCustomFractions(courseForm.prescribedFractions ? String(courseForm.prescribedFractions) : "");
                } else {
                  setFractionMode("preset");
                  setCustomFractions("");
                  props.onChange({ ...courseForm, prescribedFractions: Number(event.target.value) });
                }
              }}
            >
              {FRACTION_PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="other">Other</option>
            </select>
            {fractionMode === "other" ? (
              <input
                type="number"
                placeholder="Enter fractions"
                value={customFractions}
                style={{ marginTop: "0.4rem" }}
                onChange={(event) => {
                  setCustomFractions(event.target.value);
                  props.onChange({ ...courseForm, prescribedFractions: Number(event.target.value || 0) });
                }}
              />
            ) : null}
          </label> : null}
            <label>
              Start Date
              <input type="date" value={courseForm.startDate} onChange={(event) => props.onChange({ ...courseForm, startDate: event.target.value })} />
            </label>
            {props.showFacePhotoPicker ? (
              <label className="file-picker course-face-photo-picker">
                Face Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => props.onFacePhotoSelected?.(event.target.files?.[0])}
                />
                {props.facePhotoUploadName ? (
                  <span className="muted">Selected: {props.facePhotoUploadName}</span>
                ) : (
                  <span className="muted">Add if one is not already on file.</span>
                )}
              </label>
            ) : null}
          </div>
        <div className={`site-grid${isTwoSite ? " two-site-course-grid" : ""}`}>
            {courseForm.sites.map((site, index) => (
              <div className={`subpanel${isTwoSite ? " compact-course-subpanel" : ""}`} key={site.siteNumber}>
              <h4>{isTwoSite ? `Lesion ${site.siteNumber}` : "Lesion"}</h4>
              {showFractionsField && isTwoSite && (
                <label>
                  Prescribed Fractions
                  <select
                    value={getSiteFractionMode(index) === "other" ? "other" : selectValue(site.prescribedFractions || 10, FRACTION_PRESETS)}
                    onChange={(event) => {
                      if (event.target.value === "other") {
                        setSiteFractionModes((prev) => ({ ...prev, [index]: { mode: "other", custom: String(site.prescribedFractions ?? "") } }));
                      } else {
                        setSiteFractionModes((prev) => ({ ...prev, [index]: { mode: "preset", custom: "" } }));
                        updateSiteFractions(index, Number(event.target.value));
                      }
                    }}
                  >
                    {FRACTION_PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
                    <option value="other">Other</option>
                  </select>
                  {getSiteFractionMode(index) === "other" && (
                    <input
                      type="number"
                      placeholder="Enter fractions"
                      value={siteFractionModes[index]?.custom ?? ""}
                      style={{ marginTop: "0.4rem" }}
                      onChange={(event) => {
                        setSiteFractionModes((prev) => ({ ...prev, [index]: { ...prev[index], mode: "other", custom: event.target.value } }));
                        updateSiteFractions(index, Number(event.target.value || 0));
                      }}
                    />
                  )}
                </label>
              )}
              <label>
                Treatment Lesion
                <input placeholder="Treatment location" value={site.treatmentLocationText} onChange={(event) => {
                  const newSites = courseForm.sites.map((item, i) =>
                    i === index ? { ...item, treatmentLocationText: event.target.value, bodyLocation: event.target.value } : item
                  );
                  props.onChange({ ...courseForm, courseName: newSites.map((s) => s.treatmentLocationText).filter(Boolean).join(" + "), sites: newSites });
                }} />
              </label>
              <div className="form-grid">
                <label>
                  Diagnosis
                  <select value={site.diagnosisText} onChange={(event) => updateSite(index, { diagnosisText: event.target.value })}>
                    <option value="">Select Diagnosis</option>
                    <option value="Basal Cell Carcinoma">Basal Cell Carcinoma</option>
                    <option value="Squamous Cell Carcinoma">Squamous Cell Carcinoma</option>
                    <option value="Squamous Cell Carcinoma in-situ">Squamous Cell Carcinoma in-situ</option>
                  </select>
                </label>
                <label>
                  ICD10
                  <input
                    placeholder="ICD10"
                    value={site.icd10}
                    onChange={(event) => updateSite(index, { icd10: normalizeIcd10Input(event.target.value) })}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Cone Size
                  <select value={site.coneSize} onChange={(event) => updateSite(index, { coneSize: event.target.value })}>
                    <option value="">Select Cone</option>
                    <option value="10mm">10mm</option>
                    <option value="20mm">20mm</option>
                    <option value="35mm">35mm</option>
                    <option value="50mm">50mm</option>
                  </select>
                </label>
                <label>
                  Cutout Size
                  <select value={normalizeCutoutSizeLabel(site.cutoutSize)} onChange={(event) => updateSite(index, { cutoutSize: event.target.value })}>
                    <option value="">Select Cutout</option>
                    <option value="13mm">13mm</option>
                    <option value="15mm">15mm</option>
                    <option value="18mm">18mm</option>
                    <option value="23mm">23mm</option>
                    <option value="25mm">25mm</option>
                    <option value="27mm">27mm</option>
                    <option value="30mm">30mm</option>
                    <option value="33mm">33mm</option>
                    <option value="37mm">37mm</option>
                    <option value="45mm">45mm</option>
                    <option value="Custom Cutout">Custom Cutout</option>
                    <option value="Open Cone">Open Cone</option>
                  </select>
                </label>
                <label>
                  Lesion Size (mm)
                  <input
                    placeholder="e.g. 10mm"
                    value={site.lesionSize}
                    onChange={(event) => updateSite(index, { lesionSize: event.target.value })}
                    onBlur={(event) => updateSite(index, { lesionSize: normalizeMeasurementInput(event.target.value) })}
                  />
                </label>
                <label>
                  Treatment Depth
                  <select value={site.treatmentDepth} onChange={(event) => updateSite(index, { treatmentDepth: event.target.value })}>
                    {DEPTH_OPTIONS.map((value) => <option key={value} value={value}>{value} mm</option>)}
                  </select>
                </label>
              </div>
              <div className="worksheet-setup-grid">
                <div className="worksheet-section">
                  <label>Additional Treatment Devices</label>
                  {(() => {
                    const deviceState = getSelectedDevices(site.additionalDevices);
                    const hasCustomShield = customShieldEnabled[index] ?? Boolean(deviceState.customValue.trim());
                    return (
                      <>
                        <div className="checkbox-group compact">
                          {ADDITIONAL_DEVICE_OPTIONS.map((option) => (
                            <label className="checkbox-label" key={`worksheet-${site.siteNumber}-${option}`}>
                              <input
                                type="checkbox"
                                checked={deviceState.selected.has(option)}
                                onChange={(event) => {
                                  const nextSelected = new Set(deviceState.selected);
                                  if (event.target.checked) {
                                    nextSelected.add(option);
                                  } else {
                                    nextSelected.delete(option);
                                  }
                                  updateAdditionalDevices(index, nextSelected, deviceState.customValue);
                                }}
                              />
                              {option}
                            </label>
                          ))}
                          <label className="checkbox-label" key={`worksheet-${site.siteNumber}-custom-shield`}>
                            <input
                              type="checkbox"
                              checked={hasCustomShield}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setCustomShieldEnabled((prev) => ({ ...prev, [index]: true }));
                                  setCustomInputs((prev) => ({ ...prev, [index]: deviceState.customValue }));
                                  return;
                                }
                                setCustomShieldEnabled((prev) => ({ ...prev, [index]: false }));
                                setCustomInputs((prev) => {
                                  const next = { ...prev };
                                  delete next[index];
                                  return next;
                                });
                                updateAdditionalDevices(index, deviceState.selected, "");
                              }}
                            />
                            Custom Shield
                          </label>
                        </div>
                        {hasCustomShield ? (
                          <label style={{ marginTop: "0.35rem" }}>
                            Custom Shield Details
                            <input
                              placeholder="Enter custom shield/device"
                              value={customInputs[index] ?? deviceState.customValue}
                              onChange={(event) => {
                                const val = event.target.value;
                                setCustomInputs((prev) => ({ ...prev, [index]: val }));
                                updateAdditionalDevices(index, deviceState.selected, val);
                              }}
                              onBlur={(event) => {
                                const val = event.target.value;
                                setCustomInputs((prev) => ({ ...prev, [index]: val }));
                                updateAdditionalDevices(index, deviceState.selected, val);
                              }}
                            />
                          </label>
                        ) : null}
                      </>
                    );
                  })()}
                  <div className="form-grid compact-grid">
                      {getSelectedDevices(site.additionalDevices).selected.has("Eye Shield") ? (
                        <label>
                          Eye Shield Type
                          <select
                            value={normalizeWorksheetDetailValue(site.worksheetEyeShieldType)}
                            onChange={(event) => updateSite(index, { worksheetEyeShieldType: event.target.value })}
                          >
                            <option value="">Select type</option>
                            {EYE_SHIELD_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                      ) : null}
                      {getSelectedDevices(site.additionalDevices).selected.has("Gum Shield") ? (
                        <label>
                          Gum Shield Position
                          <select
                            value={normalizeWorksheetDetailValue(site.worksheetGumShieldPosition)}
                            onChange={(event) => updateSite(index, { worksheetGumShieldPosition: event.target.value })}
                          >
                            <option value="">Select position</option>
                            {GUM_SHIELD_POSITION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                      ) : null}
                      {getSelectedDevices(site.additionalDevices).selected.has("Lip Shield") ? (
                        <label>
                          Lip Shield Position
                          <select
                            value={normalizeWorksheetDetailValue(site.worksheetLipShieldPosition)}
                            onChange={(event) => updateSite(index, { worksheetLipShieldPosition: event.target.value })}
                          >
                            <option value="">Select position</option>
                            {LIP_SHIELD_POSITION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                      ) : null}
                  </div>
                </div>
                  <div className="worksheet-section positioning-section">
                    <label>Positioning</label>
                    <div className="position-list">
                    {(() => {
                      const selected = getWorksheetSelection(site.worksheetPositioning);
                      if (selected.has("Hunched Over Tx Couch")) {
                        selected.add("Sitting in Chair");
                      }
                      return WORKSHEET_POSITION_OPTIONS.map((option) => {
                        const optionId = `position-${site.siteNumber}-${option.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
                        return (
                          <div className="checkbox-option" key={`position-${site.siteNumber}-${option}`}>
                            <input
                              id={optionId}
                              type="checkbox"
                              checked={selected.has(option)}
                              onChange={(event) => {
                                const nextSelected = new Set(selected);
                                if (event.target.checked) {
                                  nextSelected.add(option);
                                } else {
                                  nextSelected.delete(option);
                                }
                                updateWorksheetSelection(index, "worksheetPositioning", [...nextSelected]);
                              }}
                            />
                            <label className="checkbox-option-label" htmlFor={optionId}>
                              {option}
                            </label>
                          </div>
                        );
                      });
                    })()}
                  </div>
                    {getWorksheetSelection(site.worksheetPositioning).has("Vac-Lok") ? (
                    <div className="form-grid compact-grid" style={{ marginTop: "0.5rem" }}>
                      <label>
                        Vac-Lok Area
                        <select
                          value={normalizeVacLokAreaValue(site.worksheetVacLokArea)}
                          onChange={(event) => updateSite(index, { worksheetVacLokArea: event.target.value })}
                        >
                          <option value="">Select area</option>
                          {VAC_LOK_AREA_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
                  <div className="worksheet-section lesion-side-section">
                    <label>Lesion Side</label>
                    <div className="side-list">
                      {WORKSHEET_SIDE_OPTIONS.map((option) => {
                      const selected = getWorksheetSelection(site.worksheetSide);
                      const isChecked = selected.has(option);
                      const optionId = `side-${site.siteNumber}-${option.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
                      return (
                        <div className="checkbox-option" key={`side-${site.siteNumber}-${option}`}>
                          <input
                            id={optionId}
                            type="checkbox"
                            checked={isChecked}
                            onChange={(event) => updateWorksheetSelection(index, "worksheetSide", event.target.checked ? [option] : [])}
                          />
                          <label className="checkbox-option-label" htmlFor={optionId}>
                            {option}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Daily Dose (cGy)
                  <select
                    value={getDoseMode(index, "dailyDose") === "other" ? "other" : selectValue(site.dailyDose, DAILY_DOSE_PRESETS)}
                    onChange={(event) => {
                      if (event.target.value !== "other") {
                        setDoseMode(index, "dailyDose", "preset");
                        updateSite(index, { dailyDose: Number(event.target.value) });
                      } else {
                        setDoseMode(index, "dailyDose", "other");
                      }
                    }}
                  >
                    {DAILY_DOSE_PRESETS.map((n) => <option key={n} value={n}>{n} cGy</option>)}
                    <option value="other">Other</option>
                  </select>
                  {getDoseMode(index, "dailyDose") === "other" ? (
                    <input
                      type="number"
                      placeholder="Enter cGy"
                      value={site.dailyDose || ""}
                      style={{ marginTop: "0.4rem" }}
                      onChange={(event) => updateSite(index, { dailyDose: Number(event.target.value || 0) })}
                    />
                  ) : null}
                </label>
                <label>
                  Total Dose (cGy)
                  <select
                    value={getDoseMode(index, "totalDose") === "other" ? "other" : selectValue(site.totalDose, TOTAL_DOSE_PRESETS)}
                    onChange={(event) => {
                      if (event.target.value !== "other") {
                        setDoseMode(index, "totalDose", "preset");
                        updateSite(index, { totalDose: Number(event.target.value) });
                      } else {
                        setDoseMode(index, "totalDose", "other");
                      }
                    }}
                  >
                    {TOTAL_DOSE_PRESETS.map((n) => <option key={n} value={n}>{n} cGy</option>)}
                    <option value="other">Other</option>
                  </select>
                  {getDoseMode(index, "totalDose") === "other" ? (
                    <input
                      type="number"
                      placeholder="Enter cGy"
                      value={site.totalDose || ""}
                      style={{ marginTop: "0.4rem" }}
                      onChange={(event) => updateSite(index, { totalDose: Number(event.target.value || 0) })}
                    />
                  ) : null}
                </label>
              </div>
            </div>
          ))}
          </div>
          <div className="button-row">
            <button onClick={props.onClose}>Cancel</button>
            {props.courseForm.id ? (
            <button
              style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
              onClick={() => {
                if (window.confirm("Remove this course and all of its notes, PDFs, and attached photos? This cannot be undone.")) {
                  props.onDelete?.();
                }
              }}
            >
              Remove Course
            </button>
          ) : null}
          <button className="primary" disabled={props.busy} onClick={props.onSave}>
            Save Course
          </button>
        </div>
      </div>
    </div>
  );
}
