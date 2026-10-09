import { useRef, useCallback } from 'react'

// one EMA over the union of the download and decrypt phases, so the numbers
// never sit frozen at zero while decryption is doing the real work
export default function useTransferStats() {
  const state = useRef({
    startedAt: 0,
    lastTick: 0,
    lastBytes: 0,
    rate: 0,
    received: 0,
    total: 0,
  })

  const reset = useCallback((total) => {
    const now = Date.now()
    state.current = { startedAt: now, lastTick: now, lastBytes: 0, rate: 0, received: 0, total: total || 0 }
  }, [])

  const tick = useCallback((deltaBytes, totalBytes) => {
    const s = state.current
    if (!s.startedAt) return null
    const now = Date.now()
    s.received += deltaBytes
    if (totalBytes) s.total = totalBytes

    // seed on the very first sample: a fast transfer can finish inside the 350ms
    // smoothing window, which would leave the rate and eta stuck at '--'
    if (s.rate === 0 || now - s.lastTick > 350) {
      // reset and the first tick can land in the same millisecond, which would
      // divide by zero and seed the average with Infinity
      const elapsed = Math.max(1, now - s.lastTick)
      const instant = ((s.received - s.lastBytes) / elapsed) * 1000
      if (Number.isFinite(instant) && instant > 0) {
        s.rate = s.rate === 0 ? instant : s.rate * 0.65 + instant * 0.35
      }
      s.lastTick = now
      s.lastBytes = s.received
    }

    const elapsedMs = now - s.startedAt
    const remaining = Math.max(0, s.total - s.received)
    return {
      received: s.received,
      total: s.total,
      rate: s.rate,
      elapsedMs,
      etaMs: s.rate > 0 ? (remaining / s.rate) * 1000 : null,
    }
  }, [])

  return { reset, tick }
}