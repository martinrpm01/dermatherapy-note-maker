import { describe, expect, it } from "vitest";
import { formatHeartRate, formatOxygenSaturation, formatVitals, formatWeight } from "../src/shared/note-rules";

describe("vital formatting", () => {
  it("adds missing units to heart rate, oxygen saturation, and weight", () => {
    expect(formatHeartRate("72")).toBe("72 BPM");
    expect(formatOxygenSaturation("98")).toBe("98%");
    expect(formatWeight("165")).toBe("165 lbs");
  });

  it("preserves values that already include units", () => {
    expect(formatHeartRate("72 BPM")).toBe("72 BPM");
    expect(formatHeartRate("72 bpm")).toBe("72 bpm");
    expect(formatOxygenSaturation("98%")).toBe("98%");
    expect(formatWeight("165 lbs")).toBe("165 lbs");
    expect(formatWeight("165 lb")).toBe("165 lb");
  });

  it("formats a vitals object for rendering", () => {
    expect(formatVitals({
      bloodPressure: " 120/80 ",
      heartRate: "72",
      oxygenSaturation: "98",
      weight: "165"
    })).toEqual({
      bloodPressure: "120/80",
      heartRate: "72 BPM",
      oxygenSaturation: "98%",
      weight: "165 lbs"
    });
  });
});
