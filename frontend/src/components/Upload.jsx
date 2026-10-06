import { useState, useCallback, useRef } from 'react'
import { generateKeyMaterial, encryptFile, exportKey } from '../crypto/encryption'
import { uploadBlob } from '../api/upload'
import DownloadLookup from './DownloadLookup'

const MAX_FILE_SIZE = 1024 * 1024 * 1024

export default function Upload() {
  const [file, setFile] = useState(null)
  const [encrypting, setEncrypting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadStats, setUploadStats] = useState(null)
  const [encryptProgress, setEncryptProgress] = useState(0)
  const [useEncryption, setUseEncryption] = useState(true)
  const [downloadMode, setDownloadMode] = useState('single')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [captchaVerified, setCaptchaVerified] = useState(false)
  const [captchaToken, setCaptchaToken] = useState(null)
  const fileInputRef = useRef(null)
  const honeypotRef = useRef(null)

  const handleFile = useCallback((f) => {
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setError('file exceeds 1gb limit. for larger files, use zip compression to bring the size under 1gb.')
      return
    }
    setFile(f)
    setError(null)
    setResult(null)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    handleFile(f)
  }, [handleFile])

  const handleUpload = async () => {
    if (!file) return
    if (!captchaVerified) {
      setError('please verify captcha')
      return
    }

    setUploading(true)
    setUploadStats(null)
    setError(null)
    setResult(null)

    try {
      let payload = file
      let keyFragment = null

      if (useEncryption) {
        setEncrypting(true)
        setEncryptProgress(0)

        const { keyBytes, baseNonce, cryptoKey } = await generateKeyMaterial()
        const encryptedChunks = await encryptFile(file, cryptoKey, baseNonce, (p) => {
          setEncryptProgress(p)
        }, file.name, file.type)

        payload = new Blob(encryptedChunks)
        keyFragment = exportKey(keyBytes, baseNonce)
        setEncrypting(false)
      }

      const response = await uploadBlob(payload, {
        apiUrl: import.meta.env.CB_API_URL || '',
        downloads: downloadMode,
        encrypted: useEncryption ? 'true' : 'false',
        captchaToken,
        honeypot: honeypotRef.current?.value || '',
        filename: useEncryption ? 'encrypted.bin' : file.name,
        onProgress: (stats) => setUploadStats(stats),
      })

      setUploadStats((prev) => (prev ? { ...prev, loaded: prev.total, percent: 100 } : prev))

      const downloadUrl = `${window.location.origin}/download/${response.token}`
      const shareUrl = keyFragment
        ? `${downloadUrl}#key=${keyFragment}`
        : downloadUrl

      setResult({
        url: shareUrl,
        token: response.token,
        key: keyFragment,
        size: response.size,
        fileType: response.file_type,
        expires: response.expires,
      })

    } catch (err) {
      setError(err.message || 'upload failed')
      setCaptchaToken(null)
      setCaptchaVerified(false)
    }
    setUploading(false)
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  const formatSize = (bytes) => {
    if (!bytes < 1024) return bytes + ' b'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kb'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' mb'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' gb'
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            share files <span className="gradient-text text-glow">securely</span>
          </h1>
        </div>

        <div
          className={`border border-red-500/20 rounded-2xl p-1 mb-8 transition-all duration-300 ${
            dragOver ? 'scale-[1.01]' : ''
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div
            className={`rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 cursor-pointer ${
              dragOver ? 'bg-red-500/10' : 'bg-surface-800'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
            />

            {!file ? (
              <>
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M12 2 L22 12 L12 22 L2 12 Z" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3" fill="currentColor"/>
                  </svg>
                </div>
                <p className="text-lg font-medium mb-2">drop your file here or click to browse</p>
                <p className="text-sm text-gray-500">maximum file size: 1 gb</p>
                <p className="text-xs text-gray-600 mt-2">for larger files, use zip compression to bring the size under 1gb</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M12 2 L22 12 L12 22 L2 12 Z" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3" fill="currentColor"/>
                  </svg>
                </div>
                <p className="text-lg font-medium mb-1 truncate max-w-md mx-auto">{file.name}</p>
                <p className="text-sm text-gray-500">{formatSize(file.size)}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  remove file
                </button>
              </>
            )}
          </div>
        </div>

        {file && (
          <div className="glass p-6 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">options</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-surface-700/30 border border-white/5">
                <div>
                  <p className="font-medium text-sm">end to end encryption</p>
                  <p className="text-xs text-gray-500 mt-0.5">key never leaves your browser</p>
                </div>
                <button
                  onClick={() => setUseEncryption(!useEncryption)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${
                    useEncryption ? 'bg-red-500' : 'bg-surface-600'
                  }`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                    useEncryption ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-surface-700/30 border border-white/5">
                <div>
                  <p className="font-medium text-sm">download limit</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {downloadMode === 'single' ? 'single use' : 'up to 10 downloads'}
                  </p>
                </div>
                <select
                  value={downloadMode}
                  onChange={(e) => setDownloadMode(e.target.value)}
                  className="bg-surface-600 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-red-500/50"
                >
                  <option value="single">single use</option>
                  <option value="multi">multi use</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {(encrypting || uploading) && (
          <div className="glass p-6 mb-8">
            {encrypting && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">encrypting...</span>
                  <span className="text-red-400">{encryptProgress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${encryptProgress}%` }} />
                </div>
              </div>
            )}
            {uploading && <UploadProgress stats={uploadStats} />}
          </div>
        )}

        {file && !uploading && !encrypting && (
          <div className="text-center mb-8">
            <div className="glass p-4 mb-4 max-w-md mx-auto">
              <input
                ref={honeypotRef}
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="hidden"
              />
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={captchaVerified}
                  onChange={async (e) => {
                    if (e.target.checked && !captchaToken) {
                      try {
                        const res = await fetch(`${import.meta.env.CB_API_URL || ''}/api/captcha/token`)
                        const data = await res.json()
                        setCaptchaToken(data.token)
                      } catch (err) {
                        setError('failed to load captcha')
                        return
                      }
                    }
                    setCaptchaVerified(e.target.checked)
                  }}
                  className="w-5 h-5 rounded border border-white/20 bg-surface-700 text-red-500 focus:ring-red-500/50"
                />
                <span className="text-sm text-gray-300">I am not a robot.</span>
              </label>
            </div>
            <button onClick={handleUpload} className="btn-primary text-lg px-10 py-4">
              {useEncryption ? 'encrypt & upload' : 'upload file'}
            </button>
          </div>
        )}

        {error && (
          <div className="glass p-4 mb-8 border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {result && (
          <div className="glass p-6 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium">file uploaded successfully!</p>
                <p className="text-sm text-gray-500">expires in 24 hours</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5 mb-3">
              <p className="text-xs text-gray-500 mb-2">share this link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-red-300 break-all font-mono">
                  {result.url}
                </code>
                <button
                  onClick={() => copyToClipboard(result.url)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-sm transition-colors"
                >
                  copy
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5 mb-3">
              <p className="text-xs text-gray-500 mb-2">file identifier</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-red-300 break-all font-mono">
                  {result.token}
                </code>
                <button
                  onClick={() => copyToClipboard(result.token)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-sm transition-colors"
                >
                  copy
                </button>
              </div>
            </div>

            {result.key && (
              <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5 mb-4">
                <p className="text-xs text-gray-500 mb-2">decryption key</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm text-red-300 break-all font-mono">
                    {result.key}
                  </code>
                  <button
                    onClick={() => copyToClipboard(result.key)}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-sm transition-colors"
                  >
                    copy
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500">size</p>
                <p className="text-sm font-medium">{formatSize(result.size)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">type</p>
                <p className="text-sm font-medium truncate">{result.fileType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">expires</p>
                <p className="text-sm font-medium">{new Date(result.expires).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        <DownloadLookup />

        <div className="grid sm:grid-cols-3 gap-4 mt-16">
          {[
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              ),
              title: 'zero knowledge',
              desc: 'files are encrypted in your browser. the server never sees your key.',
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              title: 'self destructing',
              desc: 'files automatically delete after 24 hours. no traces left behind.',
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
              title: 'no signup',
              desc: 'no accounts, no email, no tracking. just upload and share.',
            },
          ].map((f, i) => (
            <div key={i} className="glass glass-hover p-6">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 mb-4">
                {f.icon}
              </div>
              <h3 className="font-medium mb-2">{f.title}</h3>
              <p className="text-sm text-gray-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function formatDuration(ms) {
  if (!ms || ms < 0 || !isFinite(ms)) return '--'
  const total = Math.round(ms / 1000)
  if (total < 60) return total + 's'
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function UploadProgress({ stats }) {
  if (!stats) {
    return (
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-400">uploading...</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill w-1/4" />
        </div>
      </div>
    )
  }

  const percent = stats.total ? Math.min(100, Math.round((stats.loaded / stats.total) * 100)) : 0
  const chunkPercent = stats.chunkTotal
    ? Math.min(100, Math.round((stats.chunkLoaded / stats.chunkTotal) * 100))
    : 0

  const segments = []
  for (let i = 0; i < stats.totalParts; i++) {
    let fill = 0
    if (i < stats.chunkIndex) fill = 100
    else if (i === stats.chunkIndex) fill = chunkPercent
    segments.push(
      <div key={i} className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
        <div
          className="h-full bg-red-500 rounded-full transition-all duration-200 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-gray-400">
          uploading chunk {stats.chunkIndex + 1} of {stats.totalParts}
        </span>
        <span className="text-red-400">{percent}%</span>
      </div>

      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {stats.totalParts > 1 && (
        <div className="flex gap-1 mt-2">{segments}</div>
      )}

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
        <span>{formatBytes(stats.loaded)} of {formatBytes(stats.total)}</span>
        {stats.rate > 0 && <span>{formatBytes(stats.rate)}/s</span>}
        <span>{formatDuration(stats.elapsedMs)} elapsed</span>
        {stats.etaMs != null && stats.etaMs > 0 && stats.loaded < stats.total && (
          <span>~{formatDuration(stats.etaMs)} left</span>
        )}
      </div>
    </div>
  )
}
