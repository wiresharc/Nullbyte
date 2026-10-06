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

  const hash = window.location.hash
  const keyMatch = hash.match(/#key=([^&]+)/)
  const encryptionKey = keyMatch ? keyMatch[1] : null

  useEffect(() => {
    fetchFileInfo()
  }, [token])

  const fetchFileInfo = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/info/${token}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'file not found or expired')
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
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/download/${token}`)
      if (!response.ok) throw new Error('download failed')

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

      const encryptedData = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        encryptedData.set(chunk, offset)
        offset += chunk.length
      }

      if (encryptionKey) {
        const { cryptoKey, baseNonce } = await importKey(encryptionKey)
        const decryptedChunks = await decryptFile(encryptedData, cryptoKey, baseNonce, (p) => {
          setDecryptProgress(p)
        })

        const originalName = fileInfo?.original_name || 'downloaded_file'
        const mimeType = fileInfo?.file_type || 'application/octet-stream'

        downloadBlob(decryptedChunks, originalName, mimeType)
      } else {
        const blob = new Blob([encryptedData])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'downloaded_file'
        a.click()
        URL.revokeObjectURL(url)
      }

    } catch (err) {
      setError(err.message || 'download failed')
    }

    setDownloading(false)
  }

  const formatSize = (bytes) => {
    if (!bytes) return 'unknown'
    if (bytes < 1024) return bytes + ' b'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kb'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' mb'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' gb'
  }

  if (error) {
    return (
      <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
        <div className="glass p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 2 L22 12 L12 22 L2 12 Z" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
              </svg>
            </div>
          <h2 className="text-xl font-semibold mb-2">download unavailable</h2>
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
          <p className="text-gray-400">loading file info...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pt-24 pb-16 px-4 flex items-center justify-center">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">ready to download</h1>
          <p className="text-gray-400">this file will be available for 24 hours after upload</p>
        </div>

        <div className="border border-red-500/20 rounded-2xl p-1 mb-6">
          <div className="rounded-2xl bg-surface-800/40 p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M12 2 L22 12 L12 22 L2 12 Z" strokeLinejoin="round"/>
                  <circle cx="12" cy="12" r="3" fill="currentColor"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">shared file</p>
                <p className="text-sm text-gray-500">{formatSize(fileInfo.size)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">file type</p>
                <p className="text-sm font-medium truncate">{fileInfo.file_type || 'unknown'}</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">expires</p>
                <p className="text-sm font-medium">
                  {new Date(fileInfo.expires_at).toLocaleString()}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">downloads left</p>
                <p className="text-sm font-medium">
                  {fileInfo.max_downloads - fileInfo.downloads}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-surface-700/30 border border-white/5">
                <p className="text-xs text-gray-500 mb-1">encryption</p>
                <p className="text-sm font-medium">
                  {encryptionKey ? 'aes 256 gcm' : 'none'}
                </p>
              </div>
            </div>

            {downloading && (
              <div className="mb-6 space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">downloading...</span>
                    <span className="text-red-400">{progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                {encryptionKey && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">decrypting...</span>
                      <span className="text-red-400">{decryptProgress}%</span>
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
              {downloading ? 'processing...' : 'download file'}
            </button>

            {encryptionKey && (
              <p className="text-xs text-gray-600 text-center mt-3">
                this file is end to end encrypted. decryption happens in your browser.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
