import { useState, useCallback, useRef } from 'react'
import { generateKeyMaterial, encryptFile, exportKey } from '../crypto/encryption'

const MAX_FILE_SIZE = 1024 * 1024 * 1024 // 1GB

export default function Upload() {
  const [file, setFile] = useState(null)
  const [encrypting, setEncrypting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [encryptProgress, setEncryptProgress] = useState(0)
  const [useEncryption, setUseEncryption] = useState(true)
  const [downloadMode, setDownloadMode] = useState('single')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  const handleFile = useCallback((f) => {
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setError('File exceeds 1GB limit. For larger files, use zip compression to bring the size under 1GB.')
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

    setUploading(true)
    setProgress(0)
    setError(null)
    setResult(null)

    try {
      let fileData = file
      let keyFragment = null

      // Encrypt if enabled
      if (useEncryption) {
        setEncrypting(true)
        setEncryptProgress(0)

        const { keyBytes, baseNonce, cryptoKey } = await generateKeyMaterial()
        const encryptedChunks = await encryptFile(file, cryptoKey, baseNonce, (p) => {
          setEncryptProgress(p)
        })

        // Assemble encrypted file
        const encryptedBlob = new Blob(encryptedChunks)
        fileData = new File([encryptedBlob], file.name + '.encrypted', { type: 'application/octet-stream' })

        // Export key for URL fragment
        keyFragment = exportKey(keyBytes, baseNonce)
        setEncrypting(false)
      }

      // Upload
      const formData = new FormData()
      formData.append('file', fileData)
      formData.append('downloads', downloadMode)

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100))
        }
      })

      const response = await new Promise((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(new Error(xhr.responseText || 'Upload failed'))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.open('POST', '/api/upload')
        xhr.send(formData)
      })

      // Build download URL with key fragment
      const downloadUrl = `${window.location.origin}/download/${response.token}`
      const shareUrl = keyFragment
        ? `${downloadUrl}#key=${keyFragment}`
        : downloadUrl

      setResult({
        url: shareUrl,
        token: response.token,
        size: response.size,
        fileType: response.file_type,
        expires: response.expires,
      })

    } catch (err) {
      setError(err.message || 'Upload failed')
    } setUploading(false)
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            Share files <span className="gradient-text text-glow">securely</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            No ads. No signups. No tracking. End-to-end encrypted file sharing
            that self-destructs in 24 hours.
          </p>
        </div>

        {/* Upload Zone */}
        <div
          className={`gradient-border p-1 mb-8 transition-all duration-300 ${
            dragOver ? 'scale-[1.01]' : ''
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div
            className={`rounded-2xl p-8 sm:p-12 text-center transition-all duration-300 cursor-pointer ${
              dragOver ? 'bg-purple-500/10' : 'bg-surface-800/40'
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
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20
                              flex items-center justify-center animate-float">
                  <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-lg font-medium mb-2">Drop your file here or click to browse</p>
                <p className="text-sm text-gray-500">Maximum file size: 1 GB</p>
                <p className="text-xs text-gray-600 mt-2">For larger files, use zip compression to bring the size under 1GB</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20
                              flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-lg font-medium mb-1 truncate max-w-md mx-auto">{file.name}</p>
                <p className="text-sm text-gray-500">{formatSize(file.size)}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null) }}
                  className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  Remove file
                </button>
              </>
            )}
          </div>
        </div>

        {/* Options */}
        {file && (
          <div className="glass p-6 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">Options</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              {/* Encryption Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-surface-700/30 border border-white/5">
                <div>
                  <p className="font-medium text-sm">End-to-end encryption</p>
                  <p className="text-xs text-gray-500 mt-0.5">Key never leaves your browser</p>
                </div>
                <button
                  onClick={() => setUseEncryption(!useEncryption)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${
                    useEncryption ? 'bg-gradient-to-r from-blue-500 to-purple-600' : 'bg-surface-600'
                  }`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                    useEncryption ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Download Mode */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-surface-700/30 border border-white/5">
                <div>
                  <p className="font-medium text-sm">Download limit</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {downloadMode === 'single' ? 'Single use' : 'Up to 10 downloads'}
                  </p>
                </div>
                <select
                  value={downloadMode}
                  onChange={(e) => setDownloadMode(e.target.value)}
                  className="bg-surface-600 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value="single">Single use</option>
                  <option value="multi">Multi-use</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Progress */}
        {(encrypting || uploading) && (
          <div className="glass p-6 mb-8">
            {encrypting && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Encrypting...</span>
                  <span className="text-purple-400">{encryptProgress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${encryptProgress}%` }} />
                </div>
              </div>
            )}
            {uploading && (
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Uploading...</span>
                  <span className="text-blue-400">{progress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Upload Button */}
        {file && !uploading && !encrypting && (
          <div className="text-center mb-8">
            <button onClick={handleUpload} className="btn-primary text-lg px-10 py-4">
              {useEncryption ? 'Encrypt & Upload' : 'Upload File'}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass p-4 mb-8 border-red-500/20 bg-red-500/5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="glass p-6 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium">File uploaded successfully!</p>
                <p className="text-sm text-gray-500">Expires in 24 hours</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-700/30 border border-white/5 mb-4">
              <p className="text-xs text-gray-500 mb-2">Share this link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-purple-300 break-all font-mono">
                  {result.url}
                </code>
                <button
                  onClick={() => copyToClipboard(result.url)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-sm transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500">Size</p>
                <p className="text-sm font-medium">{formatSize(result.size)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Type</p>
                <p className="text-sm font-medium truncate">{result.fileType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Expires</p>
                <p className="text-sm font-medium">{new Date(result.expires).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Features */}
        <div className="grid sm:grid-cols-3 gap-4 mt-16">
          {[
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              ),
              title: 'Zero-Knowledge',
              desc: 'Files are encrypted in your browser. The server never sees your key.',
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              title: 'Self-Destructing',
              desc: 'Files automatically delete after 24 hours. No traces left behind.',
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
              title: 'No Signup',
              desc: 'No accounts, no email, no tracking. Just upload and share.',
            },
          ].map((f, i) => (
            <div key={i} className="glass glass-hover p-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-600/20
                              flex items-center justify-center text-purple-400 mb-4">
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
