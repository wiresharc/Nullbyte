import { useState, useEffect, useRef, useCallback } from 'react'

export const MAX_EXPIRY_SECONDS = 24 * 60 * 60
export const DEFAULT_EXPIRY_SECONDS = MAX_EXPIRY_SECONDS
const MIN_SECONDS = 60

const RING = { h: 96, m: 66, s: 40 }

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function decompose(total) {
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  }
}

export function formatDuration(total) {
  if (total <= 0) return 'expired'
  const { h, m, s } = decompose(total)
  if (h > 0) return `${h}h ${pad(m)}m`
  if (m > 0) return `${m}m ${pad(s)}s`
  return `${s}s`
}

function Ring({ value, max, size, label, onChange, accent }) {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const ratio = max > 0 ? clamp(value / max, 0, 1) : 0
  const angle = ratio * 360 - 90

  const step = (dir) => {
    const next = clamp(value + dir, 0, max)
    onChange(next)
  }

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} className="-rotate-0 select-none"
           onWheel={(e) => { e.preventDefault(); step(e.deltaY > 0 ? -1 : 1) }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="currentColor" strokeWidth="3" className="text-surface-600" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={accent} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <circle
          cx={size / 2 + r * Math.cos((angle * Math.PI) / 180)}
          cy={size / 2 + r * Math.sin((angle * Math.PI) / 180)}
          r={size / 14} fill={accent}
        />
      </svg>
      <div className="-mt-5 text-center">
        <p className="text-lg font-mono font-semibold tabular-nums">{pad(value)}</p>
        <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <div className="flex gap-1 mt-1">
        <button onClick={() => step(-1)} aria-label={`decrease ${label}`}
                className="w-6 h-6 rounded bg-surface-600 text-sm hover:bg-surface-500">−</button>
        <button onClick={() => step(1)} aria-label={`increase ${label}`}
                className="w-6 h-6 rounded bg-surface-600 text-sm hover:bg-surface-500">+</button>
      </div>
    </div>
  )
}

export default function ExpirySelector({ seconds, onChange }) {
  const total = clamp(seconds ?? DEFAULT_EXPIRY_SECONDS, MIN_SECONDS, MAX_EXPIRY_SECONDS)
  const { h, m, s } = decompose(total)

  const setTotal = useCallback((next) => {
    onChange(clamp(Math.round(next), MIN_SECONDS, MAX_EXPIRY_SECONDS))
  }, [onChange])

  const setPart = (part, value) => {
    const parts = { h, m, s }
    if (part === 'h') return setTotal((Math.min(23, Math.max(0, value)) * 3600) + m * 60 + s)
    if (part === 'm') return setTotal(h * 3600 + (Math.min(59, Math.max(0, value)) * 60) + s)
    return setTotal(h * 3600 + m * 60 + Math.min(59, Math.max(0, value)))
  }

  const drag = useRef(null)

  const onPointerDown = (e) => {
    drag.current = { y: e.clientY, base: total }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const delta = drag.current.base + (drag.current.y - e.clientY) * 300
    setTotal(delta)
  }
  const onPointerUp = () => { drag.current = null }

  const isDefault = total === MAX_EXPIRY_SECONDS

  return (
    <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <p className="font-medium text-sm">expiry</p>
          <p className="text-xs text-gray-500 mt-0.5">
            deletes itself after this time
          </p>
        </div>
        <span className="text-xs text-red-400 tabular-nums">{formatDuration(total)}</span>
      </div>

      <div className="flex items-end justify-center gap-1 mb-3"
           onPointerDown={onPointerDown}
           onPointerMove={onPointerMove}
           onPointerUp={onPointerUp}
           role="slider"
           aria-label="expiry duration"
           aria-valuemin={MIN_SECONDS}
           aria-valuemax={MAX_EXPIRY_SECONDS}
           aria-valuenow={total}
           aria-valuetext={formatDuration(total)}
           tabIndex={0}
           onKeyDown={(e) => {
             if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setTotal(total + (e.shiftKey ? 3600 : 60)) }
             if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setTotal(total - (e.shiftKey ? 3600 : 60)) }
           }}
           className="cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 rounded-lg">
        <Ring value={h} max={23} size={RING.h} label="hours"
              accent="#ef4444" onChange={(v) => setPart('h', v)} />
        <Ring value={m} max={59} size={RING.m} label="min"
              accent="#f87171" onChange={(v) => setPart('m', v)} />
        <Ring value={s} max={59} size={RING.s} label="sec"
              accent="#fb923c" onChange={(v) => setPart('s', v)} />
      </div>

      <p className="text-[11px] text-gray-600 text-center">
        max 24 hours &middot; default 24 hours (24 hours by default)
      </p>
      {!isDefault && (
        <button onClick={() => onChange(DEFAULT_EXPIRY_SECONDS)}
                className="mt-2 w-full text-xs text-red-400 hover:text-red-300 transition-colors">
          reset to 24 hours (24 hours by default)
        </button>
      )}
    </div>
  )
}