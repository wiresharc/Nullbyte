import { useEffect, useRef } from 'react'

export default function EncryptionPolicyModal({ onClose }) {
  const cardRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    cardRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/80" />

      <div
        ref={cardRef}
        tabIndex={-1}
        className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl
                   bg-surface-800 border border-white/10 outline-none"
      >
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/20
                          flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M6 10.5h12v9.75H6z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 id="policy-title" className="text-base font-semibold">Encryption is always on</h2>
            <p className="text-xs text-gray-500 mt-0.5">zero server knowledge policy</p>
          </div>
          <button
            onClick={onClose}
            aria-label="close"
            className="ml-auto w-7 h-7 rounded-lg text-gray-500 hover:text-red-400
                       hover:bg-white/5 transition-colors text-lg leading-none shrink-0"
          >
            &times;
          </button>
        </div>

        <div className="px-6 pb-6 space-y-3 text-sm text-gray-300">
          <p>
            Every upload is encrypted with AES-256-GCM before it leaves your browser.
            The key never reaches our servers, so we cannot read your files, and
            neither can anyone who gets access to them.
          </p>
          <p>
            Uploading without encryption would store your file in plaintext on our
            infrastructure. That breaks our Zero Server Knowledge policy, so this
            setting stays on.
          </p>
        </div>

        <div className="px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-red-500 hover:bg-red-600
                       font-medium transition-colors"
          >
            got it
          </button>
        </div>
      </div>
    </div>
  )
}