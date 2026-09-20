import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('GET /v1/health', () => {
  it('returns 200 with the expected JSON body', async () => {
    const res = await app.request('/v1/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'learning-assistant' })
  })
})
