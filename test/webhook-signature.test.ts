import { describe, expect, it } from 'vitest'
import { verifyWebhookSignature } from '../src/lib/webhook-signature'

async function computeHmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyWebhookSignature', () => {
  const secret = 'shared-secret'
  const body = '{"eventId":"evt-1"}'

  it('accepts a correctly computed signature', async () => {
    const signature = await computeHmacHex(secret, body)
    expect(await verifyWebhookSignature(secret, body, signature)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', async () => {
    const signature = await computeHmacHex('wrong-secret', body)
    expect(await verifyWebhookSignature(secret, body, signature)).toBe(false)
  })

  it('rejects a signature for a tampered body', async () => {
    const signature = await computeHmacHex(secret, body)
    expect(await verifyWebhookSignature(secret, `${body}x`, signature)).toBe(false)
  })

  it('rejects a missing signature', async () => {
    expect(await verifyWebhookSignature(secret, body, undefined)).toBe(false)
    expect(await verifyWebhookSignature(secret, body, null)).toBe(false)
    expect(await verifyWebhookSignature(secret, body, '')).toBe(false)
  })

  it('rejects a malformed (non-hex) signature', async () => {
    expect(await verifyWebhookSignature(secret, body, 'not-hex!!')).toBe(false)
    expect(await verifyWebhookSignature(secret, body, 'abc')).toBe(false) // odd length
  })
})
