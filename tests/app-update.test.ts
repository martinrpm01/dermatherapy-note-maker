import { describe, expect, it } from "vitest";

import {
  formatDesktopBuildLabel,
  isSameDesktopRelease,
  normalizeReleaseTag
} from "../src/shared/app-update";

describe("app update helpers", () => {
  it("compares desktop release tags case-insensitively after trimming", () => {
    expect(isSameDesktopRelease(" desktop-v0.1.0-20260508-hotfix4 ", "desktop-v0.1.0-20260508-hotfix4")).toBe(true);
    expect(isSameDesktopRelease("desktop-v0.1.0-20260508-hotfix3", "desktop-v0.1.0-20260508-hotfix4")).toBe(false);
    expect(isSameDesktopRelease("", "desktop-v0.1.0-20260508-hotfix4")).toBe(false);
  });

  it("normalizes missing release tags to an empty string", () => {
    expect(normalizeReleaseTag(null)).toBe("");
    expect(normalizeReleaseTag(undefined)).toBe("");
  });

  it("formats release labels from the tag when available", () => {
    expect(
      formatDesktopBuildLabel({
        appVersion: "0.1.0",
        releaseTag: "desktop-v0.1.0-20260508-hotfix4",
        commit: "1234567890abcdef",
        builtAt: "2026-05-08T00:00:00.000Z"
      })
    ).toBe("desktop-v0.1.0-20260508-hotfix4");
  });
});
