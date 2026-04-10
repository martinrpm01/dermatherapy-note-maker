import { useEffect, useState } from "react";
import { formatAdditionalDevices, getAutoNumberOfBlocks, normalizeCutoutSizeLabel, parseAdditionalDevices } from "../../shared/note-rules";
import type { CourseInput, PatientInput } from "../../shared/types";

const FRACTION_PRESETS = [8, 10, 12, 15];
const DAILY_DOSE_PRESETS = [350, 400, 500];
const TOTAL_DOSE_PRESETS = [4000, 4200];
const DEPTH_OPTIONS = ["3", "4", "5"];
const DEVICE_OPTIONS = ["Eye Shield", "Ear Shield"];

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
        <label className="file-picker">
          Face Photo
          <input type="file" accept="image/*" onChange={(event) => props.onFacePhotoSelected(event.target.files?.[0])} />
        </label>
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

export function CourseModal(props: {
  courseForm: CourseInput;
  busy: boolean;
  onChange: (next: CourseInput) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const courseForm = props.courseForm;
  const [customFractions, setCustomFractions] = useState("");
  const [fractionMode, setFractionMode] = useState<"preset" | "other">("preset");
  const showFractionsField = Boolean(courseForm.id);
  const [doseModes, setDoseModes] = useState<Record<number, { dailyDose: "preset" | "other"; totalDose: "preset" | "other" }>>({});
  const [siteFractionModes, setSiteFractionModes] = useState<Record<number, { mode: "preset" | "other"; custom: string }>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});

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
      ...DEVICE_OPTIONS.filter((option) => nextSelected.has(option)),
      ...customValue
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ];

    updateSite(index, {
      additionalDevices: nextValues.length ? formatAdditionalDevices(nextValues.join(", ")) : "None"
    });
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

  const isTwoSite = courseForm.courseType === "two_site";

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
      <div className="modal-card wide">
        <h3>{courseForm.id ? "Edit Course" : "Add Treatment Course"}</h3>
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
        </div>
        <div className="site-grid">
          {courseForm.sites.map((site, index) => (
            <div className="subpanel" key={site.siteNumber}>
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
              <div className="form-grid">
                <div>
                  <label>Additional Treatment Devices</label>
                  {(() => {
                    const deviceState = getSelectedDevices(site.additionalDevices);
                    return (
                      <div className="checkbox-group">
                        {DEVICE_OPTIONS.map((option) => (
                          <label className="checkbox-label" key={option}>
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
                        <label>
                          Custom Shield
                          <input
                            placeholder="Enter custom shield/device"
                            value={customInputs[index] ?? deviceState.customValue}
                            onChange={(event) => setCustomInputs((prev) => ({ ...prev, [index]: event.target.value }))}
                            onBlur={(event) => {
                              const val = event.target.value;
                              setCustomInputs((prev) => { const next = { ...prev }; delete next[index]; return next; });
                              updateAdditionalDevices(index, deviceState.selected, val);
                            }}
                          />
                        </label>
                        {!deviceState.selected.size && !deviceState.customValue.trim() ? (
                          <div className="muted">None</div>
                        ) : null}
                      </div>
                    );
                  })()}
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
