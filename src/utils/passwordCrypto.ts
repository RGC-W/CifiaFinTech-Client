const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateSaltHex(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  window.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashPasswordPBKDF2(password: string, saltHex: string): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error('Secure Web Crypto API is unavailable in this browser context.');
  }

  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const saltBytes = hexToBytes(saltHex);
  const derivedBuffer = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    DERIVED_BITS,
  );

  return bytesToHex(new Uint8Array(derivedBuffer));
}

export async function verifyPasswordPBKDF2(
  password: string,
  saltHex: string,
  expectedHashHex: string,
): Promise<boolean> {
  if (!saltHex || !expectedHashHex) return false;
  const computed = await hashPasswordPBKDF2(password, saltHex);
  if (computed.length !== expectedHashHex.length) return false;

  let diff = 0;
  for (let i = 0; i < computed.length; i += 1) {
    diff |= computed.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return diff === 0;
}
