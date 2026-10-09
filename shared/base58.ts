const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0; while (zeros < s.length && s[zeros] === '1') zeros++;
  let n = 0n;
  for (const c of s) { const v = MAP[c]; if (v === undefined) throw new Error('invalid base58'); n = n * 58n + BigInt(v); }
  const bytes: number[] = []; while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes]);
}

/** A fresh Solana Pay reference: 32 random bytes, base58 (a valid public key string). */
export function randomReference(): string {
  const b = new Uint8Array(32); crypto.getRandomValues(b); return base58Encode(b);
}
