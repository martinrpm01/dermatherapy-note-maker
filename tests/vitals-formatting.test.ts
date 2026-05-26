import { describe, expect, it } from "vitest";
import {
  formatBloodPressure,
  formatHeartRate,
  formatOxygenSaturation,
  formatPulse,
  formatVitals,
  formatWeight,
  stripExamVitalsSection
} from "../src/shared/note-rules";

describe("vital formatting", () => {
  it("adds missing units to blood pressure, heart rate, oxygen saturation, and weight", () => {
    expect(formatBloodPressure("120/80")).toBe("120/80 mmHg");
    expect(formatHeartRate("72")).toBe("72 BPM");
    expect(formatPulse("72")).toBe("72 BPM");
    expect(formatOxygenSaturation("98")).toBe("98%");
    expect(formatWeight("165")).toBe("165 lbs");
  });

  it("normalizes values that already include units or duplicate unit text", () => {
    expect(formatBloodPressure("120/80 mmHg")).toBe("120/80 mmHg");
    expect(formatBloodPressure("120/80 mmhg")).toBe("120/80 mmHg");
    expect(formatBloodPressure("120/80mmgh mmHg")).toBe("120/80 mmHg");
    expect(formatHeartRate("72 BPM")).toBe("72 BPM");
    expect(formatHeartRate("72 bpm")).toBe("72 BPM");
    expect(formatHeartRate("72bpm BPM")).toBe("72 BPM");
    expect(formatPulse("72 BPM")).toBe("72 BPM");
    expect(formatPulse("72bpm bpm")).toBe("72 BPM");
    expect(formatOxygenSaturation("98%")).toBe("98%");
    expect(formatOxygenSaturation("98%%")).toBe("98%");
    expect(formatWeight("165 lbs")).toBe("165 lbs");
    expect(formatWeight("165 lb")).toBe("165 lbs");
    expect(formatWeight("167lbs lbs")).toBe("167 lbs");
  });

  it("formats a vitals object for rendering", () => {
    expect(formatVitals({
      bloodPressure: " 120/80 ",
      heartRate: "72",
      pulse: "70",
      oxygenSaturation: "98",
      weight: "165"
    })).toEqual({
      bloodPressure: "120/80 mmHg",
      heartRate: "72 BPM",
      pulse: "70 BPM",
      oxygenSaturation: "98%",
      weight: "165 lbs"
    });
  });

  it("removes blank vital lines and hides the whole section when unused", () => {
    const rendered = [
      "Exam:",
      "Normal exam.",
      "Exam Vitals:",
      "Blood Pressure: ",
      "Heart Rate: 72 BPM",
      "Pulse: ",
      "Oxygen Saturation: 98%",
      "Weight: ",
      "",
      "Impression / Plan:",
      "Continue treatment."
    ].join("\n");

    expect(stripExamVitalsSection(rendered, "otv", true)).toContain(
      "Exam Vitals:\nHeart Rate: 72 BPM\nOxygen Saturation: 98%"
    );
    expect(stripExamVitalsSection(rendered, "otv", true)).not.toContain("Pulse:");

    const blankRendered = rendered
      .replace("Heart Rate: 72 BPM", "Heart Rate: ")
      .replace("Oxygen Saturation: 98%", "Oxygen Saturation: ");

    expect(stripExamVitalsSection(blankRendered, "otv", true)).not.toContain("Exam Vitals:");
  });
});
