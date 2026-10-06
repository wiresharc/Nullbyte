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

  const totalParts = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE))
  const totalSize = blob.size

  if (totalParts === 1) {
    const formData = new FormData()
    formData.append('downloads', downloads)
    formData.append('encrypted', encrypted)
    formData.append('captcha_token', captchaToken || '')
    formData.append('website', honeypot || '')
    formData.append('file', blob, filename)

    const sent = await sendChunk(url, formData, (loaded) => onProgress?.(loaded, totalSize))
    return sent
  }

  let uploaded = 0
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
      formData.append('filename', filename)
    }
    formData.append('file', slice, `${filename}.part${i}`)

    let partBase = uploaded
    const res = await sendChunk(url, formData, (loaded) => {
      onProgress?.(partBase + loaded, totalSize)
    })

    uploaded = partBase + slice.size

    if (res.upload_id) uploadId = res.upload_id
    if (res.token) token = res.token

    onProgress?.(uploaded, totalSize)

    if (res.done) return res
  }

  if (!token) throw new Error('upload did not complete')
  return { token, size: totalSize, done: true }
}