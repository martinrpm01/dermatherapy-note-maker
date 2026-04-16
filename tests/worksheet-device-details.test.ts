import { describe, expect, it } from "vitest";

import {
  formatAdditionalDevicesForSite,
  normalizeVacLokAreaValue,
  normalizeWorksheetDetailValue,
  normalizeWorksheetDeviceDetailsForSite
} from "../src/shared/note-rules";

describe("worksheet device detail normalization", () => {
  it("clears legacy None values from worksheet detail fields", () => {
    expect(normalizeWorksheetDetailValue("None")).toBe("");
    expect(normalizeWorksheetDetailValue("  none  ")).toBe("");
    expect(normalizeWorksheetDetailValue("External")).toBe("External");
    expect(normalizeVacLokAreaValue("NA")).toBe("");
    expect(normalizeVacLokAreaValue("n/a")).toBe("");
    expect(normalizeVacLokAreaValue("Head")).toBe("Head");
  });

  it("drops detail fields when the matching device is not selected", () => {
    expect(
      normalizeWorksheetDeviceDetailsForSite({
        additionalDevices: "Eye Shield",
        worksheetEyeShieldType: "None",
        worksheetGumShieldPosition: "Upper",
        worksheetLipShieldPosition: "Lower"
      })
    ).toEqual({
      worksheetEyeShieldType: "",
      worksheetGumShieldPosition: "",
      worksheetLipShieldPosition: ""
    });
  });

  it("keeps note text free of impossible None suffixes", () => {
    expect(
      formatAdditionalDevicesForSite({
        additionalDevices: "Eye Shield, Gum Shield, Lip Shield",
        worksheetVacLokArea: "NA",
        worksheetEyeShieldType: "None",
        worksheetGumShieldPosition: "None",
        worksheetLipShieldPosition: "None"
      })
    ).toBe("Eye Shield, Gum Shield, Lip Shield");
  });
});
