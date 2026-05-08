import { useEffect, useState } from "react";
import type { AppClient, SettingsPayload, VisitEditorState } from "../../shared/types";
import {
  applyAutomaticDoseValuesToSiteSnapshot,
  NOTE_TYPE_LABELS,
  formatBloodPressure,
  getDefaultPhysicsComment,
  getMaxSitePrescribedFractions,
  getSuggestedNoteType,
  isOtvTreatmentNumber,
  shouldIncludeExamVitals
} from "../../shared/note-rules";
import { useResolvedAssetUrl } from "./asset-url";
import { BloodPressureInput, CalendarDateInput, HeartRateInput, NumericInput, OxygenSaturationInput, VisitDateInput, WeightInput } from "./screen-components";

const STANDARD_PRESCRIBED_FRACTION_OPTIONS = [8, 10, 12] as const;

function getFractionSelectionFromValue(value: number | null | undefined, options: readonly number[]) {
  if (!(typeof value === "number" && value > 0)) {
    return "";
  }

  return options.includes(value) ? String(value) : "other";
}

function ExistingPhotoTile(props: {
  appClient: AppClient | null;
  photo: VisitEditorState["existingPhotos"][number];
  onRemove: (photoId: string) => void;
}) {
  const src = useResolvedAssetUrl(props.appClient, props.photo.imageAsset);

  return (
    <div className="photo-tile">
      {src ? <img src={src} alt="" /> : null}
      <button onClick={() => props.onRemove(props.photo.id)}>Remove</button>
    </div>
  );
}

function formatTreatmentDepthLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/\bmm\b(?:\s*\bmm\b)+/gi, "mm");
  return /mm\b/i.test(normalized) ? normalized : `${normalized} mm`;
}

function formatDoseFieldLabel(prefix: string, isTwoLesionLayout: boolean, _siteNumber: 1 | 2, bodyLocation: string, index: number) {
  return isTwoLesionLayout
    ? `${prefix} Lesion ${index + 1}${bodyLocation ? ` (${bodyLocation})` : ""}`
    : prefix;
}

function isLegacySimWorksheetAttachment(
  attachment: VisitEditorState["existingAttachments"][number]
) {
  const name = (attachment.originalName || attachment.caption || "").toLowerCase();
  return name.includes("sim worksheet");
}

export function VisitEditorScreen(props: {
  appClient: AppClient | null;
  visitEditor: VisitEditorState;
  settingsPayload: SettingsPayload | null;
  textDirty: boolean;
  onSaveDraft: () => void;
  onSaveAndGeneratePdf: () => void;
  onOpenPatient: () => void;
  onResetNoteText: () => void;
  onRemoveExistingPhoto: (photoId: string) => void;
  onRemoveExistingAttachment: (attachmentId: string) => void;
  onOpenExistingAttachment: (asset: VisitEditorState["existingAttachments"][number]["fileAsset"]) => void;
  onOpenCourseDocument: (asset: VisitEditorState["courseDocuments"][number]["fileAsset"]) => void;
  onVisitPhotoAdd: (files: FileList | null, siteNumber: 1 | 2) => void;
  onVisitAttachmentAdd: (files: FileList | null) => void;
  onUpdate: (
    updater: (current: VisitEditorState) => VisitEditorState,
    options?: { regenerate?: boolean; overwriteEdited?: boolean }
  ) => void;
  onEditedTextChange: (value: string) => void;
  onOpenLatestPdf: (asset: VisitEditorState["generatedPdfs"][number]["fileAsset"]) => void;
}) {
  const [activePanel, setActivePanel] = useState<"details" | "preview">("details");
  const [projectedFractionModes, setProjectedFractionModes] = useState<Record<number, string>>({});
  const editor = props.visitEditor;
  const showPrescribedFractionsInput =
    editor.note.noteType !== "consult_sim" &&
    (
      editor.note.treatmentNumber === 1 ||
      editor.course.prescribedFractions <= 0 ||
      (editor.note.structuredFields.prescribedFractionsInput ?? 0) > 0
    );
const showProjectedFractionsInput = false;
  const otvEligible = editor.note.noteType !== "consult_sim" && isOtvTreatmentNumber(editor.note.treatmentNumber);
  const isTwoLesionLayout = editor.note.structuredFields.siteSnapshots.length > 1;
  const sortedSiteSnapshots = [...editor.note.structuredFields.siteSnapshots].sort(
    (left, right) => left.siteNumber - right.siteNumber
  );
  const formatFractionLabel = (prefix: string, siteNumber: 1 | 2, bodyLocation: string, index: number) =>
    isTwoLesionLayout
      ? `${prefix} Lesion ${index + 1}${bodyLocation ? ` (${bodyLocation})` : ""}`
      : prefix;
  const getCurrentProjectedFractionsValue = (site: VisitEditorState["note"]["structuredFields"]["siteSnapshots"][number]) =>
    isTwoLesionLayout
      ? site.prescribedFractions ?? null
      : editor.note.structuredFields.projectedFractionsInput ?? site.prescribedFractions ?? null;

  useEffect(() => {
    setProjectedFractionModes((current) => {
      const next: Record<number, string> = {};
      sortedSiteSnapshots.forEach((site) => {
        const derivedSelection = getFractionSelectionFromValue(
          getCurrentProjectedFractionsValue(site),
          STANDARD_PRESCRIBED_FRACTION_OPTIONS
        );
        next[site.siteNumber] = derivedSelection || (current[site.siteNumber] === "other" ? "other" : "");
      });
      return next;
    });
  }, [editor.note.structuredFields.projectedFractionsInput, editor.note.structuredFields.siteSnapshots, isTwoLesionLayout]);

  const getProjectedFractionsSelection = (site: VisitEditorState["note"]["structuredFields"]["siteSnapshots"][number]) => {
    const currentFractions = getCurrentProjectedFractionsValue(site);
    const derivedSelection = getFractionSelectionFromValue(currentFractions, STANDARD_PRESCRIBED_FRACTION_OPTIONS);
    return derivedSelection || (projectedFractionModes[site.siteNumber] === "other" ? "other" : "");
  };
  const getCurrentPrescribedFractionsValue = (site: VisitEditorState["note"]["structuredFields"]["siteSnapshots"][number]) =>
    isTwoLesionLayout
      ? site.prescribedFractions ?? null
      : editor.note.structuredFields.prescribedFractionsInput ?? site.prescribedFractions ?? null;
  const getPrescribedFractionsSelection = (site: VisitEditorState["note"]["structuredFields"]["siteSnapshots"][number]) => {
    const currentFractions = getCurrentPrescribedFractionsValue(site);
    if (site.doseManuallyAdjusted) {
      return "other";
    }

    if (
      typeof currentFractions === "number" &&
      STANDARD_PRESCRIBED_FRACTION_OPTIONS.includes(currentFractions as (typeof STANDARD_PRESCRIBED_FRACTION_OPTIONS)[number])
    ) {
      return String(currentFractions);
    }

    return currentFractions ? "other" : "";
  };
  return (
    <section className={`screen visit-screen${isTwoLesionLayout ? " two-lesion-screen" : ""}`}>
      <div className="screen-header">
        <div>
          <h2>
            <button type="button" className="patient-name-button" onClick={props.onOpenPatient}>
              {editor.patient.lastName}, {editor.patient.firstName}
            </button>
          </h2>
          <p>
            {editor.course.courseName} · {editor.course.courseType === "one_site" ? "1-lesion" : "2-lesion"} course
          </p>
          <p>Visit Type: {NOTE_TYPE_LABELS[editor.note.noteType]}</p>
          {editor.course.prescribedFractions > 0 && editor.note.noteType !== "consult_sim" ? (
            <p>{`Fraction ${Math.max(editor.note.treatmentNumber ?? 0, 0)} / ${editor.course.prescribedFractions}`}</p>
          ) : null}
        </div>
        <div className="button-row">
          <button
            className={activePanel === "details" ? "tab-active" : ""}
            onClick={() => setActivePanel("details")}
          >
            Visit Details
          </button>
          <button
            className={activePanel === "preview" ? "tab-active" : ""}
            onClick={() => setActivePanel("preview")}
          >
            Note Preview
          </button>
          <button onClick={props.onSaveDraft}>Save Draft</button>
          <button className="primary" onClick={props.onSaveAndGeneratePdf}>
                  Finalize
          </button>
        </div>
      </div>
      <div className={`${activePanel === "preview" ? "editor-layout preview-mode" : "editor-layout"}${isTwoLesionLayout ? " two-lesion-editor" : ""}`}>
      {activePanel === "details" && <>
        <div className={`panel form-panel${isTwoLesionLayout ? " compact-form-panel" : ""}`}>
          <h3>Visit Details</h3>
          <div className="form-grid">
            <label>
              Visit Date
              <CalendarDateInput value={editor.note.visitDate} onChange={(next) => props.onUpdate((current) => ({ ...current, note: { ...current.note, visitDate: next } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
            </label>
            <label>
              Visit Type
              <select
                value={editor.note.noteType === "consult_sim" ? "consult_sim" : "treatment"}
                onChange={(event) => {
                  const nextMode = event.target.value;
                  props.onUpdate((current) => {
                    if (nextMode === "consult_sim") {
                      return {
                        ...current,
                        note: {
                          ...current.note,
                          noteType: "consult_sim",
                          treatmentNumber: null,
                          structuredFields: {
                            ...current.note.structuredFields,
                            siteSnapshots: current.note.structuredFields.siteSnapshots.map((site) => ({
                              ...site,
                              cumulativeDose: 0
                            }))
                          }
                        }
                      };
                    }

                    const nextTreatmentNumber = current.note.treatmentNumber ?? 1;
                    const projectedFractions =
                      getMaxSitePrescribedFractions(current.note.structuredFields.siteSnapshots) ??
                      current.note.structuredFields.projectedFractionsInput ??
                      null;
                    const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((site) =>
                      applyAutomaticDoseValuesToSiteSnapshot(
                        { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
                        nextTreatmentNumber,
                        site.prescribedFractions ?? projectedFractions
                      )
                    );
                    return {
                      ...current,
                      note: {
                        ...current.note,
                        treatmentNumber: nextTreatmentNumber,
                        noteType: getSuggestedNoteType(nextTreatmentNumber),
                        structuredFields: {
                          ...current.note.structuredFields,
                          prescribedFractionsInput:
                            nextTreatmentNumber === 1 && projectedFractions && projectedFractions > 0
                              ? projectedFractions
                              : current.note.structuredFields.prescribedFractionsInput,
                          siteSnapshots: nextSiteSnapshots
                        }
                      }
                    };
                  }, { regenerate: true, overwriteEdited: true });
                }}
              >
                <option value="consult_sim">Sim / Consult</option>
                <option value="treatment">Treatment</option>
              </select>
            </label>
            {editor.note.noteType !== "consult_sim" && (
              <label>
                Treatment Number
                <NumericInput value={editor.note.treatmentNumber ?? ""} onChange={(value) => {
                  const num = value ? Number(value) : null;
                  props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      treatmentNumber: num,
                      noteType: num !== null ? getSuggestedNoteType(num) : current.note.noteType,
                      structuredFields: {
                        ...current.note.structuredFields,
                        siteSnapshots: current.note.structuredFields.siteSnapshots.map((site) =>
                          applyAutomaticDoseValuesToSiteSnapshot(
                            { ...site, doseManuallyAdjusted: Boolean(site.doseManuallyAdjusted) },
                            num,
                            site.prescribedFractions ?? undefined
                          )
                        )
                      }
                    }
                  }), { regenerate: true, overwriteEdited: !props.textDirty });
                }} />
              </label>
            )}
            {showProjectedFractionsInput ? (
              <label>
                Therapist
                <input value={editor.note.therapistName} list="therapists" onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, therapistName: event.target.value } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
              </label>
            ) : null}
            {showProjectedFractionsInput
              ? sortedSiteSnapshots.flatMap((site, index) => {
                  const fractionSelection = getProjectedFractionsSelection(site);
                  const currentFractions = getCurrentProjectedFractionsValue(site);

                  return [
                    <label key={`projected-fractions-select-${site.siteNumber}`}>
                      {formatFractionLabel("Projected Fractions", site.siteNumber, site.bodyLocation, index)}
                      <select
                        value={fractionSelection}
                        onChange={(event) => {
                          const selection = event.target.value;
                          setProjectedFractionModes((current) => ({ ...current, [site.siteNumber]: selection }));
                          props.onUpdate((current) => {
                            const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) =>
                              snapshot.siteNumber === site.siteNumber
                                ? {
                                    ...snapshot,
                                    prescribedFractions:
                                      selection && selection !== "other"
                                        ? Number(selection)
                                        : getFractionSelectionFromValue(
                                            getCurrentProjectedFractionsValue(snapshot),
                                            STANDARD_PRESCRIBED_FRACTION_OPTIONS
                                          ) === "other"
                                          ? getCurrentProjectedFractionsValue(snapshot) ?? undefined
                                          : undefined
                                  }
                                : snapshot
                            );
                            const overallProjectedFractions = getMaxSitePrescribedFractions(nextSiteSnapshots);
                            return {
                              ...current,
                              note: {
                                ...current.note,
                                structuredFields: {
                                  ...current.note.structuredFields,
                                  projectedFractionsInput: overallProjectedFractions,
                                  siteSnapshots: nextSiteSnapshots
                                }
                              }
                            };
                          }, { regenerate: true, overwriteEdited: !props.textDirty });
                        }}
                      >
                        <option value="">Select Fractions</option>
                        {STANDARD_PRESCRIBED_FRACTION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value="other">Other</option>
                      </select>
                    </label>,
                    ...(fractionSelection === "other"
                      ? [
                          <label key={`projected-fractions-manual-${site.siteNumber}`}>
                            {formatFractionLabel("Actual Projected Fractions", site.siteNumber, site.bodyLocation, index)}
                            <NumericInput value={currentFractions ?? ""} onChange={(value) => {
                                const projectedFractions = value ? Number(value) : null;
                                props.onUpdate((current) => {
                                  const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) =>
                                    snapshot.siteNumber === site.siteNumber
                                      ? { ...snapshot, prescribedFractions: projectedFractions ?? undefined }
                                      : snapshot
                                  );
                                  const overallProjectedFractions = getMaxSitePrescribedFractions(nextSiteSnapshots);
                                  return { ...current, note: { ...current.note, structuredFields: { ...current.note.structuredFields, projectedFractionsInput: overallProjectedFractions, siteSnapshots: nextSiteSnapshots } } };
                                }, { regenerate: true, overwriteEdited: !props.textDirty });
                              }} />
                          </label>
                        ]
                      : [])
                  ];
                })
              : null}
            {showPrescribedFractionsInput
              ? sortedSiteSnapshots.flatMap((site, index) => {
                  const fractionSelection = getPrescribedFractionsSelection(site);
                  const currentFractions = getCurrentPrescribedFractionsValue(site);

                  return [
                    <label key={`prescribed-fractions-select-${site.siteNumber}`}>
                      {formatFractionLabel("Prescribed Fractions", site.siteNumber, site.bodyLocation, index)}
                      <select
                        value={fractionSelection}
                        onChange={(event) => {
                          const selection = event.target.value;
                          props.onUpdate((current) => {
                            const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) => {
                              if (snapshot.siteNumber !== site.siteNumber) {
                                return applyAutomaticDoseValuesToSiteSnapshot(
                                  { ...snapshot, doseManuallyAdjusted: Boolean(snapshot.doseManuallyAdjusted) },
                                  current.note.treatmentNumber,
                                  snapshot.prescribedFractions ?? undefined
                                );
                              }

                              if (selection === "other") {
                                return {
                                  ...snapshot,
                                  prescribedFractions: undefined,
                                  dailyDose: 0,
                                  totalDose: 0,
                                  cumulativeDose: 0,
                                  doseManuallyAdjusted: true
                                };
                              }

                              const mappedFractions = selection ? Number(selection) : null;
                              return applyAutomaticDoseValuesToSiteSnapshot(
                                {
                                  ...snapshot,
                                  prescribedFractions: mappedFractions ?? undefined,
                                  doseManuallyAdjusted: false
                                },
                                current.note.treatmentNumber,
                                mappedFractions ?? undefined
                              );
                            });
                            const overallPrescribedFractions = getMaxSitePrescribedFractions(nextSiteSnapshots);
                            return {
                              ...current,
                              course: {
                                ...current.course,
                                prescribedFractions: overallPrescribedFractions ?? 0
                              },
                              note: {
                                ...current.note,
                                structuredFields: {
                                  ...current.note.structuredFields,
                                  prescribedFractionsInput: overallPrescribedFractions,
                                  siteSnapshots: nextSiteSnapshots
                                }
                              }
                            };
                          }, { regenerate: true, overwriteEdited: !props.textDirty });
                        }}
                      >
                        <option value="">Select Fractions</option>
                        {STANDARD_PRESCRIBED_FRACTION_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value="other">Other</option>
                      </select>
                    </label>,
                    ...(fractionSelection === "other"
                      ? [
                          <label key={`prescribed-fractions-manual-${site.siteNumber}`}>
                            {formatFractionLabel("Actual Prescribed Fractions", site.siteNumber, site.bodyLocation, index)}
                            <NumericInput value={currentFractions ?? ""} onChange={(value) => {
                                const prescribedFractions = value ? Number(value) : null;
                                props.onUpdate((current) => {
                                  const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) =>
                                    snapshot.siteNumber === site.siteNumber
                                      ? { ...snapshot, prescribedFractions: prescribedFractions ?? undefined, doseManuallyAdjusted: true }
                                      : snapshot
                                  );
                                  const overallPrescribedFractions = getMaxSitePrescribedFractions(nextSiteSnapshots);
                                  return { ...current, course: { ...current.course, prescribedFractions: overallPrescribedFractions ?? 0 }, note: { ...current.note, structuredFields: { ...current.note.structuredFields, prescribedFractionsInput: overallPrescribedFractions, siteSnapshots: nextSiteSnapshots } } };
                                }, { regenerate: true, overwriteEdited: !props.textDirty });
                              }} />
                          </label>
                        ]
                      : [])
                  ];
                })
              : null}
            {editor.note.noteType !== "consult_sim"
              ? sortedSiteSnapshots.flatMap((site, index) =>
                  getPrescribedFractionsSelection(site) === "other"
                    ? [
                  <label key={`daily-dose-${site.siteNumber}`}>
                    {formatDoseFieldLabel("Daily Dose (cGy)", isTwoLesionLayout, site.siteNumber, site.bodyLocation, index)}
                    <NumericInput value={site.dailyDose > 0 ? site.dailyDose : ""}
                      onChange={(value) => {
                        const dailyDose = value ? Number(value) : 0;
                        props.onUpdate((current) => {
                          const treatmentNumber = current.note.treatmentNumber ?? 0;
                          return {
                            ...current,
                            note: {
                              ...current.note,
                              structuredFields: {
                                ...current.note.structuredFields,
                                siteSnapshots: current.note.structuredFields.siteSnapshots.map((snapshot) =>
                                  snapshot.siteNumber === site.siteNumber
                                    ? { ...snapshot, dailyDose, cumulativeDose: dailyDose * treatmentNumber, doseManuallyAdjusted: true }
                                    : snapshot
                                )
                              }
                            }
                          };
                        }, { regenerate: true, overwriteEdited: !props.textDirty });
                      }}
                    />
                  </label>,
                  <label key={`total-dose-${site.siteNumber}`}>
                    {formatDoseFieldLabel("Total Dose (cGy)", isTwoLesionLayout, site.siteNumber, site.bodyLocation, index)}
                    <NumericInput value={site.totalDose > 0 ? site.totalDose : ""}
                      onChange={(value) => {
                        const totalDose = value ? Number(value) : 0;
                        props.onUpdate((current) => ({
                          ...current,
                          note: { ...current.note, structuredFields: { ...current.note.structuredFields, siteSnapshots: current.note.structuredFields.siteSnapshots.map((snapshot) => snapshot.siteNumber === site.siteNumber ? { ...snapshot, totalDose, doseManuallyAdjusted: true } : snapshot) } }
                        }), { regenerate: true, overwriteEdited: !props.textDirty });
                      }}
                    />
                  </label>
                ]
                    : []
                )
              : null}
            {editor.note.noteType !== "consult_sim" ? (
              <label>
                Therapist
                <input value={editor.note.therapistName} list="therapists" onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, therapistName: event.target.value } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
              </label>
            ) : null}
            {editor.note.noteType !== "consult_sim" && (() => {
              const POST_CARE_OPTIONS = [
                { label: "Aquaphor", value: "Aquaphor was applied to the treated area." },
                { label: "Vaseline", value: "Vaseline was applied to the treated area." },
                { label: "No ointment applied", value: "No ointment was applied to the treated area." }
              ];
              const current = editor.note.structuredFields.postCare ?? "";
              const isPreset = POST_CARE_OPTIONS.some((o) => o.value === current);
              return (
                <label>
                  Post-Care Ointment
                  <select
                    value={isPreset ? current : "custom"}
                    onChange={(event) => {
                      if (event.target.value === "custom") return;
                      props.onUpdate((s) => ({
                        ...s,
                        note: { ...s.note, structuredFields: { ...s.note.structuredFields, postCare: event.target.value } }
                      }), { regenerate: true, overwriteEdited: !props.textDirty });
                    }}
                  >
                    {POST_CARE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {!isPreset && <option value="custom">Custom</option>}
                  </select>
                </label>
              );
            })()}
          </div>
          <label>
            Additional Notes
            <textarea
              value={editor.note.structuredFields.additionalNotes ?? ""}
              onChange={(event) =>
                props.onUpdate(
                  (current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      structuredFields: {
                        ...current.note.structuredFields,
                        additionalNotes: event.target.value
                      }
                    }
                  }),
                  { regenerate: true, overwriteEdited: !props.textDirty }
                )
              }
            />
          </label>
          {editor.note.noteType === "consult_sim" ? (
            <div className="form-grid">
              {editor.note.structuredFields.siteSnapshots.map((site, index) => (
                <label key={`biopsy-date-${site.siteNumber}`}>
                  {editor.note.structuredFields.siteSnapshots.length === 1
                    ? "Biopsy Date"
                    : `Biopsy Date Lesion ${index + 1}${site.bodyLocation ? ` (${site.bodyLocation})` : ""}`}
                  <CalendarDateInput
                    value={site.biopsyDate || editor.note.structuredFields.biopsyDate || ""}
                    onChange={(next) =>
                      props.onUpdate(
                        (current) => {
                          const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) =>
                            snapshot.siteNumber === site.siteNumber
                              ? { ...snapshot, biopsyDate: next }
                              : snapshot
                          );
                          return {
                            ...current,
                            note: {
                              ...current.note,
                              structuredFields: {
                                ...current.note.structuredFields,
                                biopsyDate:
                                  nextSiteSnapshots[0]?.biopsyDate ?? current.note.structuredFields.biopsyDate,
                                siteSnapshots: nextSiteSnapshots
                              }
                            }
                          };
                        },
                        { regenerate: true, overwriteEdited: !props.textDirty }
                      )
                    }
                  />
                </label>
              ))}
              <label>
                Treatment Start Date
                <CalendarDateInput
                  value={editor.note.structuredFields.startRadiationDate}
                  onChange={(next) => props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      structuredFields: {
                        ...current.note.structuredFields,
                        startRadiationDate: next
                      }
                    }
                  }), { regenerate: true, overwriteEdited: !props.textDirty })}
                />
              </label>
            </div>
          ) : (
            <div className="form-grid">
              <label>
                {editor.note.noteType === "first_fraction" ? "Consult Date" : "Previous Treatment Date"}
                <VisitDateInput
                  value={editor.note.structuredFields.lastTreatmentDate ?? ""}
                  onChange={(next) =>
                    props.onUpdate(
                      (current) => ({
                        ...current,
                        note: {
                          ...current.note,
                          structuredFields: {
                            ...current.note.structuredFields,
                            lastTreatmentDate: next
                          }
                        }
                      }),
                      { regenerate: true, overwriteEdited: !props.textDirty }
                    )
                  }
                />
              </label>
              <label>
                Follow Up
                <textarea value={editor.note.structuredFields.followUp} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, structuredFields: { ...current.note.structuredFields, followUp: event.target.value } } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
              </label>
            </div>
          )}
          {(editor.note.noteType === "consult_sim" || editor.note.noteType === "otv") && (
            <div>
              <div className="summary-checkboxes" style={{ marginBottom: "0.4rem" }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={shouldIncludeExamVitals(
                      editor.note.noteType,
                      editor.note.structuredFields.includeExamVitals
                    )}
                    onChange={(event) =>
                      props.onUpdate(
                        (current) => ({
                          ...current,
                          note: {
                            ...current.note,
                            structuredFields: {
                              ...current.note.structuredFields,
                              includeExamVitals: event.target.checked
                            }
                          }
                        }),
                        { regenerate: true, overwriteEdited: !props.textDirty }
                      )
                    }
                  />
                  Include Exam Vitals
                </label>
              </div>
              {shouldIncludeExamVitals(editor.note.noteType, editor.note.structuredFields.includeExamVitals) ? (
                <>
                  <h4 style={{ margin: "0 0 0.4rem" }}>Exam Vitals</h4>
                  <div className="form-grid">
                    <label>
                      Blood Pressure
                      <BloodPressureInput
                        value={editor.note.vitals.bloodPressure}
                        onChange={(next) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, bloodPressure: next } } }), { regenerate: true, overwriteEdited: !props.textDirty })}
                      />
                    </label>
                    <label>
                      Heart Rate
                      <HeartRateInput
                        value={editor.note.vitals.heartRate}
                        onChange={(next) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, heartRate: next } } }), { regenerate: true, overwriteEdited: !props.textDirty })}
                      />
                    </label>
                    <label>
                      O2 Saturation
                      <OxygenSaturationInput
                        value={editor.note.vitals.oxygenSaturation}
                        onChange={(next) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, oxygenSaturation: next } } }), { regenerate: true, overwriteEdited: !props.textDirty })}
                      />
                    </label>
                    <label>
                      Weight
                      <WeightInput
                        value={editor.note.vitals.weight}
                        onChange={(next) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, weight: next } } }), { regenerate: true, overwriteEdited: !props.textDirty })}
                      />
                    </label>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
        <div className={`panel summary-panel${isTwoLesionLayout ? " compact-summary-panel" : ""}`}>
          <div className="summary-checkboxes">
            {editor.note.noteType === "consult_sim" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!editor.note.structuredFields.ultrasoundPerformed}
                  onChange={(event) => props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      structuredFields: {
                        ...current.note.structuredFields,
                        ultrasoundPerformed: event.target.checked
                          ? "Ultrasound Performed:\nAn ultrasound of the lesion was completed to determine tumor extent in order to select the best course of treatment for the lesion. The image was reviewed, and radiation therapy was selected as the treatment plan."
                          : ""
                      }
                    }
                  }), { regenerate: true, overwriteEdited: true })}
                />
                Ultrasound Performed
              </label>
            )}
            {otvEligible ? (
              <div className="checkbox-with-help">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editor.note.noteType === "otv"}
                    onChange={(event) =>
                      props.onUpdate(
                        (current) => ({
                          ...current,
                          note: {
                            ...current.note,
                            noteType: event.target.checked ? "otv" : "standard_treatment",
                            structuredFields: {
                              ...current.note.structuredFields,
                              physicsComment: event.target.checked
                                ? current.note.structuredFields.physicsComment?.trim() || getDefaultPhysicsComment("otv")
                                : current.note.structuredFields.physicsComment
                            }
                          }
                        }),
                        { regenerate: true, overwriteEdited: true }
                      )
                    }
                  />
                  OTV?
                </label>
                <span className="help-chip" tabIndex={0} aria-label="OTV help">
                  ?
                  <span className="help-popover">
                    Uncheck if this should be a normal treatment visit instead of OTV, for example when the doctor is out of office.
                  </span>
                </span>
              </div>
            ) : null}
            {editor.note.noteType !== "consult_sim" && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!editor.note.structuredFields.finalTreatment}
                  onChange={(event) => props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      structuredFields: {
                        ...current.note.structuredFields,
                        finalTreatment: event.target.checked
                      }
                    }
                  }), { regenerate: true, overwriteEdited: true })}
                />
                Final Treatment
              </label>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!editor.note.structuredFields.addMips}
                onChange={(event) => props.onUpdate((current) => ({
                  ...current,
                  note: {
                    ...current.note,
                    structuredFields: {
                      ...current.note.structuredFields,
                      addMips: event.target.checked
                    }
                  }
                }), { regenerate: true, overwriteEdited: true })}
              />
              Add MIPS
            </label>
          </div>
          <div className="site-grid">
            {editor.note.structuredFields.siteSnapshots.map((site) => (
              <div className="subpanel" key={site.siteNumber}>
                <h4>Lesion {site.siteNumber}</h4>
                <div className="visit-site-summary">
                  <p><strong>Treatment Lesion:</strong> {site.bodyLocation || "-"}</p>
                  <p><strong>Diagnosis:</strong> {site.diagnosisText || "-"}</p>
                  <p><strong>ICD10:</strong> {site.icd10 || "-"}</p>
                  <p>
                    <strong>Treatment Depth:</strong>{" "}
                    {site.treatmentDepth
                      ? formatTreatmentDepthLabel(site.treatmentDepth)
                      : "-"}
                  </p>
                  <p><strong>Daily Dose:</strong> {site.dailyDose ? `${site.dailyDose} cGy` : "-"}</p>
                  <p><strong>Total Dose:</strong> {site.totalDose ? `${site.totalDose} cGy` : "-"}</p>
                </div>
              </div>
            ))}
          </div>
          {editor.note.structuredFields.siteSnapshots.map((site) => {
            const isTwoSite = editor.note.structuredFields.siteSnapshots.length > 1;
            const sitePhotos = editor.existingPhotos.filter((p) => (p.siteNumber ?? 1) === site.siteNumber);
            const pendingPhotos = editor.note.newPhotoUploads.filter((u) => (u.siteNumber ?? 1) === site.siteNumber);
            const locationLabel = site.treatmentLocationText || `Lesion ${site.siteNumber}`;
            const uploadLabel = isTwoSite ? `${locationLabel} Photos` : "Attach Daily Treatment Photos";
            return (
              <div key={site.siteNumber}>
                <label className="file-picker">
                  {uploadLabel}
                  <input type="file" accept="image/*" multiple onChange={(event) => props.onVisitPhotoAdd(event.target.files, site.siteNumber)} />
                </label>
                <div className="photo-strip">
                  {sitePhotos.map((photo) => (
                    <ExistingPhotoTile key={photo.id} appClient={props.appClient} photo={photo} onRemove={props.onRemoveExistingPhoto} />
                  ))}
                  {pendingPhotos.map((photo) => (
                    <div className="photo-tile" key={photo.name + photo.dataUrl.slice(0, 12)}>
                      <img src={photo.dataUrl} alt="" />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <label className="file-picker">
            Additional Attachments
            <input
              type="file"
              accept="image/*,.pdf,application/pdf"
              multiple
              onChange={(event) => props.onVisitAttachmentAdd(event.target.files)}
            />
          </label>
            {editor.courseDocuments.length ? (
              <div className="attachment-list">
                {editor.courseDocuments.map((document) => (
                  <div className="attachment-row" key={document.id}>
                    <div>
                      <div className="attachment-name">{document.originalName || document.caption || "Course document"}</div>
                      <div className="muted">Linked course document</div>
                    </div>
                    <div className="button-row">
                      <button onClick={() => props.onOpenCourseDocument(document.fileAsset)}>Open</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="attachment-list">
              {editor.existingAttachments.map((attachment) => (
                <div className="attachment-row" key={attachment.id}>
                  <div>
                    <div className="attachment-name">{attachment.originalName || attachment.caption || "Attachment"}</div>
                    <div className="muted">
                      {attachment.mimeType.toLowerCase().includes("pdf") ? "PDF attachment" : "Image attachment"}
                    </div>
                  </div>
                  <div className="button-row">
                    <button onClick={() => props.onOpenExistingAttachment(attachment.fileAsset)}>Open</button>
                    {!isLegacySimWorksheetAttachment(attachment) ? (
                      <button onClick={() => props.onRemoveExistingAttachment(attachment.id)}>Remove</button>
                    ) : null}
                  </div>
                </div>
              ))}
            {editor.note.newAttachmentUploads.map((attachment) => (
              <div className="attachment-row" key={attachment.name + attachment.dataUrl.slice(0, 12)}>
                <div>
                  <div className="attachment-name">{attachment.name}</div>
                  <div className="muted">
                    {attachment.mimeType.toLowerCase().includes("pdf") ? "PDF attachment" : "Image attachment"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
      {activePanel === "preview" && <div className="panel note-panel">
        <h3>Note Text</h3>
        <textarea className="note-textarea" value={editor.note.editedText} onChange={(event) => props.onEditedTextChange(event.target.value)} />
        <div className="button-row">
          {editor.generatedPdfs[0] ? <button onClick={() => props.onOpenLatestPdf(editor.generatedPdfs[0].fileAsset)}>Open Latest PDF</button> : null}
        </div>
      </div>}
      </div>
      {props.settingsPayload ? (
        <datalist id="therapists">
          {props.settingsPayload.savedOptions.filter((option) => option.type === "therapist").map((option) => (
            <option key={option.id} value={option.value} />
          ))}
        </datalist>
      ) : null}
    </section>
  );
}
