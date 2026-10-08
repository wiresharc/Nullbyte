import { compressToStore } from '../crypto/compress.js'
import {
  ENC_CHUNK,
  CHUNKS_PER_PART,
  PART_SIZE,
  ciphertextSize,
  plainChunkCount,
  encryptChunkRange,
  buildHeader,
  concatChunks,
} from '../crypto/encryption.js'

const RESUME_KEY = 'cryptbyte.pending'
const MAX_ATTEMPTS = 3

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function sendPart(url, formData, onProgress) {
  const xhr = new XMLHttpRequest()

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable && onProgress) onProgress(e.loaded)
  })

  return new Promise((resolve, reject) => {
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(new Error('bad response from server'))
        }
      } else {
        reject(new Error(xhr.responseText || `upload failed (${xhr.status})`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('network error')))
    xhr.addEventListener('abort', () => reject(new Error('upload aborted')))
    xhr.open('POST', url)
    xhr.send(formData)
  })
}

async function sendWithRetry(url, build, onProgress, shouldAbort) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (shouldAbort && shouldAbort()) throw new Error('upload cancelled')
    try {
      return await sendPart(url, build(), onProgress)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt * attempt)
    }
  }
  throw lastErr
}

export function readPendingUpload() {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPendingUpload() {
  try {
    sessionStorage.removeItem(RESUME_KEY)
  } catch {}
}

function savePendingUpload(state) {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(state))
  } catch {}
}

async function askServerStatus(apiUrl, uploadId) {
  const body = new FormData()
  body.append('upload_id', uploadId)
  const res = await fetch(`${apiUrl}/api/upload/status`, { method: 'POST', body })
  if (!res.ok) return null
  return res.json()
}

function plan(opts, store) {
  const { encrypted, compress, name, type } = opts

  if (!encrypted) {
    const totalSize = blob.size
    return {
      encrypted: false,
      totalSize,
      plainTotal: totalSize,
      totalParts: Math.max(1, Math.ceil(totalSize / PART_SIZE)),
      chunkCount: 0,
      header: null,
    }
  }

  const header = buildHeader(name, type, compress)
  const plainTotal = header.length + store.size
  const chunkCount = plainChunkCount(store.size, header.length)
  const totalSize = ciphertextSize(store.size, header.length)

  return {
    encrypted: true,
    totalSize,
    plainTotal,
    totalParts: Math.ceil(totalSize / PART_SIZE),
    chunkCount,
    header,
    payload: store,
  }
}

function plainChunkLength(planData, i) {
  const remaining = planData.plainTotal - i * ENC_CHUNK
  return Math.max(0, Math.min(ENC_CHUNK, remaining))
}

function partSizeAt(planData, index) {
  if (!planData.encrypted) {
    return Math.max(0, Math.min(PART_SIZE, planData.totalSize - index * PART_SIZE))
  }
  const first = index * CHUNKS_PER_PART
  const last = Math.min(first + CHUNKS_PER_PART, planData.chunkCount)
  let size = 0
  for (let i = first; i < last; i++) size += plainChunkLength(planData, i) + 16
  return size
}

async function* produceParts(opts, blob, planData, startPart) {
  const { encrypted, compress, cryptoKey, baseNonce } = opts

  if (!encrypted) {
    for (let i = startPart; i < planData.totalParts; i++) {
      const start = i * PART_SIZE
      const slice = blob.slice(start, Math.min(start + PART_SIZE, planData.totalSize))
      const bytes = new Uint8Array(await slice.arrayBuffer())
      yield { index: i, bytes }
    }
    return
  }

  const total = planData.chunkCount
  for (let i = startPart; i < planData.totalParts; i++) {
    const firstChunk = i * CHUNKS_PER_PART
    const lastChunk = Math.min(firstChunk + CHUNKS_PER_PART, total)
    if (firstChunk >= total) break

    const source = new Blob([planData.header, blob])
    const sealed = await encryptChunkRange(source, cryptoKey, baseNonce, firstChunk, lastChunk, compress)
    yield { index: i, bytes: concatChunks(sealed) }
  }
}

async function produceFirstPart(opts, store, planData) {
  for await (const part of produceParts(opts, store, planData, 0)) return part
  throw new Error('upload produced no data')
}

export async function uploadBlob(blob, opts) {
  const {
    apiUrl, downloads, encrypted, compress, captchaToken, honeypot,
    filename, onProgress, signal, resume,
  } = opts

  let source = blob
  let compression = null

  if (opts.encrypted && opts.compress) {
    const result = await compressToStore(blob, (sent) => {
      onProgress?.({
        phase: 'compressing',
        loaded: sent,
        total: blob.size,
        chunkIndex: 0,
        totalParts: 0,
        chunkLoaded: sent,
        chunkTotal: blob.size,
        rate: 0,
        elapsedMs: 0,
        etaMs: null,
        chunks: [{ loaded: sent, total: blob.size }],
      })
    })
    source = result.blob
    compression = { from: blob.size, to: result.size, spilled: result.spilled }
  }

  const planData = plan(opts, source)
  const url = `${apiUrl}/api/upload`

  let uploadId = resume?.uploadId || null
  let skipTo = 0

  if (resume?.uploadId) {
    const status = await askServerStatus(apiUrl, resume.uploadId)
    if (status && status.total_parts === planData.totalParts && status.total_size === planData.totalSize) {
      const received = new Set(status.received)
      let contiguous = 0
      while (received.has(contiguous) && contiguous < planData.totalParts) contiguous++
      uploadId = status.upload_id
      skipTo = contiguous
    } else {
      uploadId = null
    }
  }

  let carriedBytes = 0
  for (let i = 0; i < skipTo; i++) carriedBytes += partSizeAt(planData, i)

  const startedAt = Date.now()
  let uploaded = carriedBytes
  let rate = 0
  let lastTick = startedAt
  let lastBytes = carriedBytes


  function report(index, withinPart, partBytes) {
    const now = Date.now()
    const done = uploaded

    if (now - lastTick > 350) {
      const instant = ((done - lastBytes) / (now - lastTick)) * 1000
      rate = instant > 0 ? (rate === 0 ? instant : rate * 0.65 + instant * 0.35) : rate
      lastTick = now
      lastBytes = done
    }

    onProgress?.({
      loaded: done,
      total: planData.totalSize,
      chunkIndex: index,
      totalParts: planData.totalParts,
      chunkLoaded: withinPart,
      chunkTotal: partBytes,
      rate,
      elapsedMs: now - startedAt,
      etaMs: rate > 0 ? ((planData.totalSize - done) / rate) * 1000 : null,
      chunks: [{ loaded: withinPart, total: partBytes }],
    })
  }

  const pending = {
    uploadId: null,
    totalSize: planData.totalSize,
    totalParts: planData.totalParts,
    filename,
    encrypted,
    compress,
    keyB64: opts.keyB64 || null,
    createdAt: Date.now(),
  }

  let token = null

  // a single part needs no chunk framing, so the real filename reaches the server
  if (planData.totalParts === 1 && !uploadId) {
    const only = await produceFirstPart(opts, source, planData)
    const formData = new FormData()
    formData.append('downloads', downloads)
    formData.append('encrypted', encrypted ? 'true' : 'false')
    formData.append('captcha_token', captchaToken || '')
    formData.append('website', honeypot || '')
    formData.append('file', new Blob([only.bytes], { type: 'application/octet-stream' }), filename)

    const res = await sendWithRetry(url, () => formData, null, () => signal?.aborted)
    clearPendingUpload()
    return { token: res.token, size: planData.totalSize, done: true, compression }
  }

  for await (const part of produceParts(opts, source, planData, skipTo)) {
    const slice = part.bytes
    const isFirstPart = part.index === 0

    const formData = new FormData()
    formData.append('part_index', String(part.index))
    formData.append('total_parts', String(planData.totalParts))
    formData.append('total_size', String(planData.totalSize))
    if (uploadId) formData.append('upload_id', uploadId)
    if (isFirstPart) {
      formData.append('downloads', downloads)
      formData.append('encrypted', encrypted ? 'true' : 'false')
      formData.append('captcha_token', captchaToken || '')
      formData.append('website', honeypot || '')
    }
    formData.append(
      'file',
      new Blob([slice], { type: 'application/octet-stream' }),
      `${filename}.part${part.index}`
    )

    const base = uploaded
    const res = await sendWithRetry(
      url,
      () => formData,
      (within) => report(part.index, within, slice.size),
      () => signal?.aborted
    )

    uploaded = base + slice.size

    if (res.upload_id) {
      uploadId = res.upload_id
      pending.uploadId = uploadId
      savePendingUpload(pending)
    }
    if (res.token) token = res.token

    report(part.index, slice.size, slice.size)

    if (res.done) {
      clearPendingUpload()
      return { token: res.token, size: planData.totalSize, done: true, compression }
    }
  }

  clearPendingUpload()
  if (!token) throw new Error('upload did not complete')
  return { token, size: planData.totalSize, done: true, compression }
}