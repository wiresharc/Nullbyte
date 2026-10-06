import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { importKey, decryptFile, downloadBlob } from '../crypto/encryption'

export default function Download() {
  const { token } = useParams()
  const [fileInfo, setFileInfo] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [decryptProgress, setDecryptProgress] = useState(0)

  // Extract key from URL fragment
  const hash = window.location.hash
  const keyMatch = hash.match(/#key=([^&]+)/)
  const encryptionKey = keyMatch ? keyMatch[1] : null

  useEffect(() => {
    fetchFileInfo()
  }, [token])

  const fetchFileInfo = async () => {
    try {
      const res = await fetch(`/api/info/${token}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'File not found or expired')
      }
      const data = await res.json()
      setFileInfo(data)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setProgress(0)
    setDecryptProgress(0)

    try {
      // Download encrypted file
      const response = await fetch(`/api/download/${token}`)
      if (!response.ok) throw new Error('Download failed')

      const contentLength = +response.headers.get('Content-Length')
      const reader = response.body.getReader()
      const chunks = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (contentLength) {
          setProgress(Math.round((received / contentLength) * 100))
        }
      }

      // Assemble encrypted data
      const encryptedData = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        encryptedData.set(chunk, offset)
        offset += chunk.length
      }

      // Decrypt if key is present
      if (encryptionKey) {
        const { cryptoKey, baseNonce } = await importKey(encryptionKey)
        const decryptedChunks = await decryptFile(encryptedData, cryptoKey, baseNonce, (p) => {
          setDecryptProgress(p)
        })

        // Try to determine original filename and type
        const originalName = fileInfo?.original_name || 'downloaded_file'
        const mimeType = fileInfo?.file_type || 'application/octet-stream'

        downloadBlob(decryptedChunks, originalName, mimeType)
      } else {
        // No encryption, download as-is
        const blob = new Blob([encryptedData])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'downloaded_file'
        a.click()
        URL.revokeObjectURL(url)
      }

    } catch (err) {
      setError(err.message || 'Download failed')
    }

    setDownloading(false)
  }

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  if (error) {
    return (
      <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
        <div className="glass p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Download Unavailable</h2>
          <p className="text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!fileInfo) {
    return (
      <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
        <div className="glass p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-surface-700/50 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <p className="text-gray-400">Loading file info...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Ready to download</h1>
          <p className="text-gray-400">This file will be available for 24 hours after upload</p>
        </div>

        <div className="gradient-border p-1 mb-6">
          <div className="rounded-2xl bg-surface-800/40 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20
                              flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">Shared File</p>
                <p className="text-sm text-gray-500">{formatSize(fileInfo.size)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">File type</p>
                <p className="text-sm font-medium truncate">{fileInfo.file_type || 'Unknown'}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">Expires</p>
                <p className="text-sm font-medium">
                  {new Date(fileInfo.expires_at).toLocaleString()}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">Downloads left</p>
                <p className="text-sm font-medium">
                  {fileInfo.max_downloads - fileInfo.downloads}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">Encryption</p>
                <p className="text-sm font-medium">
                  {encryptionKey ? 'AES-256-GCM' : 'None'}
                </p>
              </div>
            </div>

            {/* Progress */}
            {downloading && (
              <div className="mb-6 space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Downloading...</span>
                    <span className="text-blue-400">{progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                {encryptionKey && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">Decrypting...</span>
                      <span className="text-purple-400">{decryptProgress}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${decryptProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="btn-primary w-full py-4 text-lg"
            >
              {downloading ? 'Processing...' : 'Download File'}
            </button>

            {encryptionKey && (
              <p className="text-xs text-gray-600 text-center mt-3">
                This file is end-to-end encrypted. Decryption happens in your browser.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
