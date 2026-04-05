import scryptJs from "scrypt-js";

const PIN_SALT_BYTES = 16;
const RECOVERY_CODE_LENGTH = 12;
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  if (value.length % 2 !== 0) {
    throw new Error("Hex value must have an even number of characters.");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index]! ^ right[index]!;
  }
  return result === 0;
}

export function ensureValidPin(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("PIN must be 4 to 8 digits.");
  }
}

export function generatePinSalt() {
  const bytes = new Uint8Array(PIN_SALT_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateRecoveryCode() {
  const bytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  const characters = Array.from(bytes, (byte) => RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length]!);
  return `${characters.slice(0, 4).join("")}-${characters.slice(4, 8).join("")}-${characters.slice(8, 12).join("")}`;
}

export function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase();
}

export async function hashPin(pin: string, salt: string) {
  const hashBytes = await scryptJs.scrypt(
    textEncoder.encode(pin),
    textEncoder.encode(salt),
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    KEY_LENGTH
  );
  return bytesToHex(hashBytes);
}

export async function verifyPin(pin: string, salt: string, expectedHash: string) {
  const actualHash = await hashPin(pin, salt);
  return constantTimeBytesEqual(hexToBytes(actualHash), hexToBytes(expectedHash));
}
