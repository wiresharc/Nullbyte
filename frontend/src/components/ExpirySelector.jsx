import { useState, useRef, useEffect, useCallback } from 'react'

export const MAX_EXPIRY_SECONDS = 24 * 60 * 60
export const DEFAULT_EXPIRY_SECONDS = MAX_EXPIRY_SECONDS
const MIN_SECONDS = 60
const MAX_HOURS = 24

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

// press and hold to run the value up, speeding up the longer it is held
function useHoldRepeat(step) {
  const timers = useRef({ delay: null, tick: null })
  // the repeating timers outlive the render that started them, so they must call
  // the newest step or they keep recomputing the same value forever
  const stepRef = useRef(step)
  stepRef.current = step

  const stop = useCallback(() => {
    const { delay, tick } = timers.current
    if (delay) clearTimeout(delay)
    if (tick) clearInterval(tick)
    timers.current = { delay: null, tick: null }
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(() => {
    stop()
    stepRef.current()

    let interval = 130

    const begin = () => {
      timers.current.delay = setTimeout(function run() {
        stepRef.current()
        interval -= 12
        if (interval <= 45) {
          timers.current.tick = setInterval(step, 45)
        } else {
          begin()
        }
      }, 380)
    }
    begin()
  }, [stop])

  return { start, stop }
}

function NumberBox({ value, label, onStep, onSet }) {
  const [draft, setDraft] = useState(null)
  const repeat = useHoldRepeat(() => onStep(1))
  const downRepeat = useHoldRepeat(() => onStep(-1))

  const shown = draft !== null ? draft : pad(value)

  const commitDraft = () => {
    if (draft === null) return
    const digits = draft.replace(/\D/g, '')
    if (digits === '') {
      setDraft(null)
      onSet(0)
      return
    }
    setDraft(null)
    onSet(Number(digits))
  }

  return (
    <div className="flex-1 flex flex-col items-center gap-2">
      <div className="w-full">
        <input
          value={shown}
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '')
            setDraft(raw)
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDraft()
              e.currentTarget.blur()
            }
            if (e.key === 'ArrowUp') { e.preventDefault(); onStep(1) }
            if (e.key === 'ArrowDown') { e.preventDefault(); onStep(-1) }
          }}
          className="w-full text-center text-3xl font-mono font-semibold tabular-nums
                     py-3 rounded-xl bg-surface-800 border border-white/10
                     focus:outline-none focus:border-red-500/60 focus:ring-1
                     focus:ring-red-500/30"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onPointerDown={downRepeat.start}
          onPointerUp={downRepeat.stop}
          onPointerLeave={downRepeat.stop}
          onPointerCancel={downRepeat.stop}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`decrease ${label}`}
          className="w-9 h-9 rounded-lg bg-surface-600 hover:bg-surface-500
                     active:bg-red-500 transition-colors text-lg leading-none select-none"
        >
          &minus;
        </button>
        <button
          onPointerDown={repeat.start}
          onPointerUp={repeat.stop}
          onPointerLeave={repeat.stop}
          onPointerCancel={repeat.stop}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`increase ${label}`}
          className="w-9 h-9 rounded-lg bg-surface-600 hover:bg-surface-500
                     active:bg-red-500 transition-colors text-lg leading-none select-none"
        >
          +
        </button>
      </div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
    </div>
  )
}

export default function ExpirySelector({ seconds, onChange }) {
  const total = clamp(seconds ?? DEFAULT_EXPIRY_SECONDS, MIN_SECONDS, MAX_EXPIRY_SECONDS)
  const { h, m, s } = decompose(total)

  const setPart = (part, value) => {
    if (part === 'h') {
      const hours = clamp(Math.round(value), 0, MAX_HOURS)
      // 24h is the ceiling, so it can only ever be 24:00:00
      if (hours >= MAX_HOURS) return onChange(MAX_EXPIRY_SECONDS)
      return onChange(clamp(hours * 3600 + m * 60 + s, MIN_SECONDS, MAX_EXPIRY_SECONDS))
    }
    if (part === 'm') {
      const mins = clamp(Math.round(value), 0, 59)
      let next = h * 3600 + mins * 60 + s
      // the ceiling is 24h, so drop an hour rather than silently discarding the
      // value that was just typed
      if (next > MAX_EXPIRY_SECONDS) next = (MAX_HOURS - 1) * 3600 + mins * 60 + s
      return onChange(clamp(next, MIN_SECONDS, MAX_EXPIRY_SECONDS))
    }
    const secs = clamp(Math.round(value), 0, 59)
    let next = h * 3600 + m * 60 + secs
    if (next > MAX_EXPIRY_SECONDS) next = (MAX_HOURS - 1) * 3600 + m * 60 + secs
    return onChange(clamp(next, MIN_SECONDS, MAX_EXPIRY_SECONDS))
  }

  const isDefault = total === MAX_EXPIRY_SECONDS

  return (
    <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <p className="font-medium text-sm">expiry</p>
          <p className="text-xs text-gray-500 mt-0.5">deletes itself after this time</p>
        </div>
        <span className="text-xs text-red-400 tabular-nums">{formatDuration(total)}</span>
      </div>

      <div className="flex gap-2 mb-3">
        <NumberBox
          value={h}
          label="hours"
          onStep={(d) => setPart('h', h + d)}
          onSet={(v) => setPart('h', v)}
        />
        <NumberBox
          value={m}
          label="min"
          onStep={(d) => setPart('m', m + d)}
          onSet={(v) => setPart('m', v)}
        />
        <NumberBox
          value={s}
          label="sec"
          onStep={(d) => setPart('s', s + d)}
          onSet={(v) => setPart('s', v)}
        />
      </div>

      <p className="text-[11px] text-gray-600 text-center">
        max 24 hours (24 hours by default)
      </p>
      {!isDefault && (
        <button
          onClick={() => onChange(DEFAULT_EXPIRY_SECONDS)}
          className="mt-2 w-full text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          reset to 24 hours
        </button>
      )}
    </div>
  )
}