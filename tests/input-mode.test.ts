import { describe, expect, it } from "vitest";

import { shouldUseTouchOptimizedInputsForEnvironment } from "../src/renderer/src/screen-components";

describe("touch optimized input detection", () => {
  it("uses normal editable inputs in the installed desktop app", () => {
    expect(
      shouldUseTouchOptimizedInputsForEnvironment({
        isElectronDesktop: true,
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
        platform: "iPad",
        maxTouchPoints: 5
      })
    ).toBe(false);
  });

  it("uses normal editable inputs in desktop browser sessions even with touch hardware", () => {
    expect(
      shouldUseTouchOptimizedInputsForEnvironment({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 10
      })
    ).toBe(false);
  });

  it("uses the docked numpad for iPad Safari and iPad PWA-style user agents", () => {
    expect(
      shouldUseTouchOptimizedInputsForEnvironment({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
        platform: "iPad",
        maxTouchPoints: 5
      })
    ).toBe(true);

    expect(
      shouldUseTouchOptimizedInputsForEnvironment({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/604.1",
        platform: "MacIntel",
        maxTouchPoints: 5
      })
    ).toBe(true);
  });
});
