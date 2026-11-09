// HMAC-SHA-256 verification for the Team 17 (Internship) inbound webhook.
// Uses only the Web Crypto API (native to Cloudflare Workers, and to
// Vitest's Node test environment) — no extra dependency.

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Verifies that `signatureHex` is the HMAC-SHA-256 (hex-encoded) of the
 * exact `rawBody` string under `secret`. The caller must pass the raw
 * request body text captured before any JSON parsing — signing/verifying
 * a re-serialized copy would not match what the sender actually signed.
 *
 * Comparison is timing-safe via `crypto.subtle.verify`, not a manual
 * string/byte comparison.
 */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHex: string | undefined | null,
): Promise<boolean> {
  if (!signatureHex) return false

  const signatureBytes = hexToBytes(signatureHex.trim())
  if (!signatureBytes) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )

  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(rawBody))
}
