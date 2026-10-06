const CHUNK_SIZE = 90 * 1024 * 1024

function sendChunk(url, formData, onProgress) {
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
        reject(new Error(xhr.responseText || 'upload failed'))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('network error')))
    xhr.addEventListener('abort', () => reject(new Error('upload aborted')))
    xhr.open('POST', url)
    xhr.send(formData)
  })
}

export async function uploadBlob(blob, opts) {
  const { downloads, encrypted, captchaToken, honeypot, filename, onProgress } = opts
  const url = `${opts.apiUrl}/api/upload`

  const totalSize = blob.size
  const totalParts = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE))

  const sizes = []
  for (let i = 0; i < totalParts; i++) {
    const start = i * CHUNK_SIZE
    sizes.push(Math.min(CHUNK_SIZE, totalSize - start))
  }

  const chunkLoaded = new Array(totalParts).fill(0)
  const chunkStartedAt = new Array(totalParts).fill(null)
  const chunkDoneAt = new Array(totalParts).fill(null)

  const startedAt = Date.now()
  let uploaded = 0
  let rate = 0
  let lastTick = startedAt
  let lastBytes = 0

  function report(chunkIndex, totalLoaded) {
    const now = Date.now()
    const done = Math.min(totalLoaded, totalSize)

    if (now - lastTick > 350) {
      const instant = ((done - lastBytes) / (now - lastTick)) * 1000
      rate = instant > 0 ? (rate === 0 ? instant : rate * 0.65 + instant * 0.35) : rate
      lastTick = now
      lastBytes = done
    }

    const remaining = totalSize - done

    onProgress?.({
      loaded: done,
      total: totalSize,
      chunkIndex,
      totalParts,
      rate,
      elapsedMs: now - startedAt,
      etaMs: rate > 0 ? (remaining / rate) * 1000 : null,
      chunks: sizes.map((size, i) => ({
        loaded: chunkLoaded[i],
        total: size,
        startedAt: chunkStartedAt[i],
        doneAt: chunkDoneAt[i],
      })),
    })
  }

  report(0, 0)

  if (totalParts === 1) {
    const formData = new FormData()
    formData.append('downloads', downloads)
    formData.append('encrypted', encrypted)
    formData.append('captcha_token', captchaToken || '')
    formData.append('website', honeypot || '')
    formData.append('file', blob, filename)

    chunkStartedAt[0] = startedAt
    const res = await sendChunk(url, formData, (loaded) => {
      chunkLoaded[0] = loaded
      report(0, loaded)
    })
    chunkLoaded[0] = totalSize
    chunkDoneAt[0] = Date.now()
    return res
  }

  let token = null
  let uploadId = null

  for (let i = 0; i < totalParts; i++) {
    const start = i * CHUNK_SIZE
    const slice = blob.slice(start, Math.min(start + CHUNK_SIZE, totalSize))

    const formData = new FormData()
    formData.append('part_index', String(i))
    formData.append('total_parts', String(totalParts))
    formData.append('total_size', String(totalSize))
    if (uploadId) formData.append('upload_id', uploadId)
    if (i === 0) {
      formData.append('downloads', downloads)
      formData.append('encrypted', encrypted)
      formData.append('captcha_token', captchaToken || '')
      formData.append('website', honeypot || '')
    }
    formData.append('file', slice, `${filename}.part${i}`)

    const base = uploaded
    chunkStartedAt[i] = Date.now()

    const res = await sendChunk(url, formData, (loaded) => {
      chunkLoaded[i] = loaded
      report(i, base + loaded)
    })

    chunkLoaded[i] = slice.size
    chunkDoneAt[i] = Date.now()
    uploaded = base + slice.size

    if (res.upload_id) uploadId = res.upload_id
    if (res.token) token = res.token

    report(i, uploaded)

    if (res.done) return res
  }

  if (!token) throw new Error('upload did not complete')
  return { token, size: totalSize, done: true }
}
