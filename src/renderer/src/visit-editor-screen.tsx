import { useState } from "react";
import type { AppClient, SettingsPayload, VisitEditorState } from "../../shared/types";
import { NOTE_TYPE_LABELS, getDefaultPhysicsComment, getSuggestedNoteType, isOtvTreatmentNumber } from "../../shared/note-rules";
import { useResolvedAssetUrl } from "./asset-url";

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

export function VisitEditorScreen(props: {
  appClient: AppClient | null;
  visitEditor: VisitEditorState;
  settingsPayload: SettingsPayload | null;
  textDirty: boolean;
  onSaveDraft: () => void;
  onSaveAndGeneratePdf: () => void;
  onResetNoteText: () => void;
  onRemoveExistingPhoto: (photoId: string) => void;
  onRemoveExistingAttachment: (attachmentId: string) => void;
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
  const editor = props.visitEditor;
  const showPrescribedFractionsInput =
    editor.note.noteType !== "consult_sim" &&
    (editor.course.prescribedFractions <= 0 || (editor.note.structuredFields.prescribedFractionsInput ?? 0) > 0);
  const otvEligible = editor.note.noteType !== "consult_sim" && isOtvTreatmentNumber(editor.note.treatmentNumber);
  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <h2>
            {editor.patient.lastName}, {editor.patient.firstName}
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
            Save + Generate PDF
          </button>
        </div>
      </div>
      <div className={activePanel === "preview" ? "editor-layout preview-mode" : "editor-layout"}>
      {activePanel === "details" && <>
        <div className="panel form-panel">
          <h3>Visit Details</h3>
          <div className="form-grid">
            <label>
              Visit Date
              <input type="date" value={editor.note.visitDate} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, visitDate: event.target.value } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
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
                    return {
                      ...current,
                      note: {
                        ...current.note,
                        treatmentNumber: nextTreatmentNumber,
                        noteType: getSuggestedNoteType(nextTreatmentNumber),
                        structuredFields: {
                          ...current.note.structuredFields,
                          siteSnapshots: current.note.structuredFields.siteSnapshots.map((site) => ({
                            ...site,
                            cumulativeDose: site.dailyDose * nextTreatmentNumber
                          }))
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
                <input type="number" min={1} max={15} value={editor.note.treatmentNumber ?? ""} onChange={(event) => {
                  const num = event.target.value ? Number(event.target.value) : null;
                  props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      treatmentNumber: num,
                      noteType: num !== null ? getSuggestedNoteType(num) : current.note.noteType,
                      structuredFields: {
                        ...current.note.structuredFields,
                        siteSnapshots: current.note.structuredFields.siteSnapshots.map((site) => ({ ...site, cumulativeDose: site.dailyDose * (num ?? 0) }))
                      }
                    }
                  }), { regenerate: true, overwriteEdited: !props.textDirty });
                }} />
              </label>
            )}
            {showPrescribedFractionsInput ? (
              <label>
                Prescribed Fractions
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={editor.note.structuredFields.prescribedFractionsInput ?? ""}
                  onChange={(event) => {
                    const prescribedFractions = event.target.value ? Number(event.target.value) : null;
                    props.onUpdate((current) => ({
                      ...current,
                      course: {
                        ...current.course,
                        prescribedFractions: prescribedFractions ?? 0
                      },
                      note: {
                        ...current.note,
                        structuredFields: {
                          ...current.note.structuredFields,
                          prescribedFractionsInput: prescribedFractions
                        }
                      }
                    }), { regenerate: true, overwriteEdited: !props.textDirty });
                  }}
                />
              </label>
            ) : null}
            <label>
              Therapist
              <input value={editor.note.therapistName} list="therapists" onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, therapistName: event.target.value } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
            </label>
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
                  <input
                    type="date"
                    value={site.biopsyDate || editor.note.structuredFields.biopsyDate || ""}
                    onChange={(event) =>
                      props.onUpdate(
                        (current) => {
                          const nextSiteSnapshots = current.note.structuredFields.siteSnapshots.map((snapshot) =>
                            snapshot.siteNumber === site.siteNumber
                              ? { ...snapshot, biopsyDate: event.target.value }
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
                <input
                  type="date"
                  value={editor.note.structuredFields.startRadiationDate}
                  onChange={(event) => props.onUpdate((current) => ({
                    ...current,
                    note: {
                      ...current.note,
                      structuredFields: {
                        ...current.note.structuredFields,
                        startRadiationDate: event.target.value
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
                <input
                  type="date"
                  value={editor.note.structuredFields.lastTreatmentDate ?? ""}
                  onChange={(event) =>
                    props.onUpdate(
                      (current) => ({
                        ...current,
                        note: {
                          ...current.note,
                          structuredFields: {
                            ...current.note.structuredFields,
                            lastTreatmentDate: event.target.value
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
              <h4 style={{ margin: "0 0 0.4rem" }}>Exam Vitals</h4>
              <div className="form-grid">
                <label>
                  Blood Pressure
                  <input placeholder="e.g. 120/80" value={editor.note.vitals.bloodPressure} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, bloodPressure: event.target.value } } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
                </label>
                <label>
                  Heart Rate
                  <input placeholder="e.g. 72" value={editor.note.vitals.heartRate} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, heartRate: event.target.value } } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
                </label>
                <label>
                  O2 Saturation
                  <input placeholder="e.g. 98%" value={editor.note.vitals.oxygenSaturation} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, oxygenSaturation: event.target.value } } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
                </label>
                <label>
                  Weight
                  <input placeholder="e.g. 165 lbs" value={editor.note.vitals.weight} onChange={(event) => props.onUpdate((current) => ({ ...current, note: { ...current.note, vitals: { ...current.note.vitals, weight: event.target.value } } }), { regenerate: true, overwriteEdited: !props.textDirty })} />
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="panel summary-panel">
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
                  <p><strong>Treatment Depth:</strong> {site.treatmentDepth ? `${site.treatmentDepth} mm` : "-"}</p>
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
          <div className="attachment-list">
            {editor.existingAttachments.map((attachment) => (
              <div className="attachment-row" key={attachment.id}>
                <div>
                  <div className="attachment-name">{attachment.originalName || attachment.caption || "Attachment"}</div>
                  <div className="muted">
                    {attachment.mimeType.toLowerCase().includes("pdf") ? "PDF attachment" : "Image attachment"}
                  </div>
                </div>
                <button onClick={() => props.onRemoveExistingAttachment(attachment.id)}>Remove</button>
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
