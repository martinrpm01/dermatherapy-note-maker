import { describe, expect, it } from "vitest";
import { createEmptyVitals } from "../src/shared/note-rules";
import { resetVitalsForVisitTypeChange, syncEditedVisitVitals } from "../src/shared/visit-vitals";
import type { NoteType, Vitals } from "../src/shared/types";

const filled: Vitals = { bloodPressure: "120/80", heartRate: "72", pulse: "70", oxygenSaturation: "98", weight: "165" };
const original = ["Exam Comment:", "Custom narrative: patient walked 2 miles.", "", "Exam Vitals:", "Blood Pressure: 130/90 mmHg", "Heart Rate: 80 BPM", "Pulse: 78 BPM", "Oxygen Saturation: 95%", "Weight: 180 lbs", "", "Impression / Plan:", "Continue the plan for 20 fractions."].join("\n");

describe("visit vital isolation", () => {
  it.each<[NoteType, NoteType]>([["consult_sim", "otv"], ["otv", "consult_sim"], ["otv", "follow_up"], ["follow_up", "first_fraction"], ["consult_sim", "follow_up"]])("clears vitals when changing %s to %s without changing the source", (previous, next) => {
    expect(resetVitalsForVisitTypeChange(previous, next, filled)).toEqual(createEmptyVitals());
    expect(filled.weight).toBe("165");
  });

  it.each<[NoteType, NoteType]>([["first_fraction", "otv"], ["otv", "standard_treatment"], ["otv", "otv"], ["consult_sim", "consult_sim"], ["follow_up", "follow_up"]])("preserves the same %s visit when edited as %s using a fresh object", (previous, next) => {
    const result = resetVitalsForVisitTypeChange(previous, next, filled);
    expect(result).toEqual(filled);
    expect(result).not.toBe(filled);
  });
});

describe("edited note vital synchronization", () => {
  it("removes every blank vital and its heading while preserving custom narrative and other numbers", () => {
    const result = syncEditedVisitVitals(original, original, "otv", createEmptyVitals());
    expect(result).not.toMatch(/Exam Vitals:|Blood Pressure:|Heart Rate:|Pulse:|Oxygen Saturation:|Weight:/);
    expect(result).toContain("Custom narrative: patient walked 2 miles.");
    expect(result).toContain("Continue the plan for 20 fractions.");
  });

  it("replaces stale values with only currently filled fields", () => {
    const result = syncEditedVisitVitals(original, original, "consult_sim", { ...createEmptyVitals(), heartRate: " 72 bpm ", weight: " 165 lbs " });
    expect(result).toContain("Exam Vitals:\nHeart Rate: 72 BPM\nWeight: 165 lbs");
    expect(result).not.toMatch(/130\/90|80 BPM|78 BPM|95%|180 lbs|Blood Pressure:|Oxygen Saturation:/);
    expect(result).toContain("Continue the plan for 20 fractions.");
  });

  it("preserves CRLF while updating values and is idempotent", () => {
    const result = syncEditedVisitVitals(original.replace(/\n/g, "\r\n"), original, "otv", filled);
    expect(result).toContain("Exam Vitals:\r\nBlood Pressure: 120/80 mmHg");
    expect(result).not.toMatch(/(?<!\r)\n/);
    expect(syncEditedVisitVitals(result, original, "otv", filled)).toBe(result);
  });

  it("restores a deleted section before the matching generated section without replacing custom text", () => {
    const edited = "Exam:\nMy custom skin examination.\n\nImpression / Plan:\nMy customized plan.";
    const result = syncEditedVisitVitals(edited, original, "consult_sim", { ...createEmptyVitals(), oxygenSaturation: "99" });
    expect(result).toBe("Exam:\nMy custom skin examination.\n\nExam Vitals:\nOxygen Saturation: 99%\n\nImpression / Plan:\nMy customized plan.");
    expect(syncEditedVisitVitals(result, original, "consult_sim", { ...createEmptyVitals(), oxygenSaturation: "99" })).toBe(result);
  });

  it("uses the Exam Comment boundary when no generated anchor or impression heading survives", () => {
    const edited = "Exam Comment:\nCustom discussion with the patient.\n\nCustom closing narrative.";
    const result = syncEditedVisitVitals(edited, "", "otv", { ...createEmptyVitals(), pulse: "68" });
    expect(result).toBe("Exam Comment:\nCustom discussion with the patient.\n\nExam Vitals:\nPulse: 68 BPM\n\nCustom closing narrative.");
  });

  it("preserves clinician narrative after a reading on the same line, including unrelated numbers", () => {
    const edited = "Exam Vitals:\nWeight: 180 lbs - Patient discussed a 1500 calorie meal plan.\nPulse: 78 BPM\n\nImpression / Plan:\nPatient has 2 questions.";
    const result = syncEditedVisitVitals(edited, original, "otv", createEmptyVitals());
    expect(result).toContain("- Patient discussed a 1500 calorie meal plan.");
    expect(result).toContain("Patient has 2 questions.");
    expect(result).not.toContain("180 lbs");
    expect(result).not.toContain("Weight:");
    expect(result).not.toContain("Exam Vitals:");
  });

  it("preserves unrelated numbers and wording that are not a canonical reading", () => {
    const edited = "HPI:\nWeight: 180 lbs was recorded last year by another office.\n\nExam Vitals:\nWeight: Discussed 2 prior readings.\nHeart Rate: 80 BPM\n\nImpression / Plan:\nContinue.";
    const result = syncEditedVisitVitals(edited, original, "otv", createEmptyVitals());
    expect(result).toContain("Weight: 180 lbs was recorded last year by another office.");
    expect(result).toContain("Weight: Discussed 2 prior readings.");
    expect(result).not.toContain("80 BPM");
  });

  it("clears common missing-reading markers while retaining an explanatory note", () => {
    const edited = "Exam Vitals:\nBlood Pressure: not obtained mmHg - Patient declined repeat measurement.\nHeart Rate: N/A BPM\nWeight: -- lbs\n\nImpression / Plan:\nContinue.";
    const result = syncEditedVisitVitals(edited, original, "otv", createEmptyVitals());
    expect(result).toContain("- Patient declined repeat measurement.");
    expect(result).not.toMatch(/Exam Vitals:|Blood Pressure:|Heart Rate:|Weight:|N\/A BPM|-- lbs/);
  });

  it.each<NoteType>(["first_fraction", "standard_treatment", "follow_up"])("removes stale canonical vitals and never inserts them for %s", (noteType) => {
    const result = syncEditedVisitVitals(original, original, noteType, filled);
    expect(result).not.toContain("Exam Vitals:");
    expect(result).not.toContain("Blood Pressure:");
    expect(syncEditedVisitVitals("Custom note only.", original, noteType, filled)).toBe("Custom note only.");
  });

  it("removes heading-only and duplicate canonical sections", () => {
    const edited = "Exam Vitals:\n\nExam Vitals:\nWeight: 180 lbs\n\nImpression / Plan:\nContinue.";
    const result = syncEditedVisitVitals(edited, original, "otv", filled);
    expect(result.match(/Exam Vitals:/g)).toHaveLength(1);
    expect(result.match(/Weight:/g)).toHaveLength(1);
    expect(syncEditedVisitVitals(result, original, "otv", filled)).toBe(result);
    expect(syncEditedVisitVitals("Exam Vitals:\n\nImpression / Plan:\nContinue.", original, "otv", createEmptyVitals())).not.toContain("Exam Vitals:");
  });

  it("preserves the empty manual-override sentinel", () => {
    expect(syncEditedVisitVitals("", original, "otv", filled)).toBe("");
    expect(syncEditedVisitVitals("  ", original, "otv", filled)).toBe("  ");
  });
});
