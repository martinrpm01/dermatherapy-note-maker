import { describe, expect, it } from "vitest";
import {
  formatBloodPressure,
  formatHeartRate,
  formatOxygenSaturation,
  formatVitals,
  formatWeight
} from "../src/shared/note-rules";

describe("vital formatting", () => {
  it("adds missing units to blood pressure, heart rate, oxygen saturation, and weight", () => {
    expect(formatBloodPressure("120/80")).toBe("120/80 mmHg");
    expect(formatHeartRate("72")).toBe("72 BPM");
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
      oxygenSaturation: "98",
      weight: "165"
    })).toEqual({
      bloodPressure: "120/80 mmHg",
      heartRate: "72 BPM",
      oxygenSaturation: "98%",
      weight: "165 lbs"
    });
  });
});
