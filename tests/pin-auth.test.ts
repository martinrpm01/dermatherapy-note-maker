import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { ensureValidPin, generatePinSalt, hashPin, verifyPin } from "../src/shared/pin-auth";

describe("shared pin auth helpers", () => {
  it("matches the desktop scrypt hash output for the same pin and salt", async () => {
    const pin = "1234";
    const salt = "0123456789abcdef0123456789abcdef";

    const browserCompatibleHash = await hashPin(pin, salt);
    const nodeHash = crypto.scryptSync(pin, salt, 64).toString("hex");

    expect(browserCompatibleHash).toBe(nodeHash);
  });

  it("verifies correct pins and rejects incorrect ones", async () => {
    const pin = "5678";
    const salt = "abcdef0123456789abcdef0123456789";
    const hash = await hashPin(pin, salt);

    await expect(verifyPin(pin, salt, hash)).resolves.toBe(true);
    await expect(verifyPin("0000", salt, hash)).resolves.toBe(false);
  });

  it("creates 16-byte salts encoded as 32 hex characters", () => {
    const salt = generatePinSalt();

    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it("enforces the same pin validation rules as desktop", () => {
    expect(() => ensureValidPin("1234")).not.toThrow();
    expect(() => ensureValidPin("123")).toThrow("PIN must be 4 to 8 digits.");
    expect(() => ensureValidPin("abcd")).toThrow("PIN must be 4 to 8 digits.");
    expect(() => ensureValidPin("123456789")).toThrow("PIN must be 4 to 8 digits.");
  });
});
