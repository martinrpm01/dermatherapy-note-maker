import { describe, expect, it } from "vitest";
import {
  formatAdditionalDevicesForSite,
  normalizeVacLokPlacement,
  siteHasVacLok
} from "../src/shared/note-rules";

describe("Vac-Lok hotfix", () => {
  it("moves Vac-Lok from additional devices into worksheet positioning", () => {
    expect(
      normalizeVacLokPlacement("Eye Shield, Vac-Lok", "Supine")
    ).toEqual({
      additionalDevices: "Eye Shield",
      worksheetPositioning: "Supine, Vac-Lok"
    });
  });

  it("omits Vac-Lok from note-facing additional device text", () => {
    expect(
      formatAdditionalDevicesForSite({
        additionalDevices: "Vac-Lok, Eye Shield, Gum Shield",
        worksheetVacLokArea: "Head",
        worksheetEyeShieldType: "External",
        worksheetGumShieldPosition: "Upper",
        worksheetLipShieldPosition: "None"
      })
    ).toBe("Eye Shield - External, Gum Shield - Upper");
  });

  it("still recognizes Vac-Lok for worksheet population from either storage path", () => {
    expect(siteHasVacLok({ additionalDevices: "Vac-Lok", worksheetPositioning: "" })).toBe(true);
    expect(siteHasVacLok({ additionalDevices: "None", worksheetPositioning: "Supine, Vac-Lok" })).toBe(true);
  });
});
