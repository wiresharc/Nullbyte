import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function DownloadLookup() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [key, setKey] = useState('')
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const fetchInfo = async () => {
    const t = token.trim()
    if (!t) return

    setBusy(true)
    setError(null)
    setInfo(null)
    setKey('')

    try {
      const res = await fetch(`${import.meta.env.CB_API_URL || ''}/api/info/${t}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'file not found or expired')
      }
      setInfo(await res.json())
    } catch (err) {
      setError(err.message)
    }

    setBusy(false)
  }

  const open = () => {
    const t = token.trim()
    const k = key.trim()
    navigate(k ? `/download/${t}#key=${k}` : `/download/${t}`)
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold">
          or download a <span className="gradient-text text-glow">shared file</span>
        </h2>
      </div>

      <div className="border border-red-500/20 rounded-2xl p-1 mb-8">
        <div className="rounded-2xl p-8 sm:p-12 text-center bg-surface-800">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2 L22 12 L12 22 L2 12 Z" strokeLinejoin="round"/>
              <circle cx="12" cy="12" r="3" fill="currentColor"/>
            </svg>
          </div>
          <p className="text-lg font-medium mb-2">enter the file identifier</p>
          <p className="text-sm text-gray-500 mb-6">the code from the share link</p>

          <div className="max-w-md mx-auto space-y-3 text-left">
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="file identifier"
              className="w-full px-4 py-3 bg-surface-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 transition-all duration-200"
            />

            {info?.encrypted && (
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="decryption key"
                className="w-full px-4 py-3 bg-surface-700/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 transition-all duration-200"
              />
            )}

            {info && (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-gray-500">size</p>
                  <p className="text-sm font-medium">{formatSize(info.size)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">type</p>
                  <p className="text-sm font-medium truncate">{info.file_type || 'unknown'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">expires</p>
                  <p className="text-sm font-medium">{new Date(info.expires_at).toLocaleString()}</p>
                </div>
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={fetchInfo} disabled={busy || !token.trim()} className="btn-primary">
              {busy ? 'looking up...' : 'fetch file'}
            </button>
            {info && (
              <button onClick={open} disabled={info.encrypted && !key.trim()} className="btn-primary">
                download
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatSize(bytes) {
  if (!bytes) return 'unknown'
  if (bytes < 1024) return bytes + ' b'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kb'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' mb'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' gb'
}