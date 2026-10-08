const STORE_NAME = 'cryptbyte-scratch'

async function opfsFile() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(`${STORE_NAME}.gz`, { create: true })
    return handle
  } catch {
    return null
  }
}

async function removeOpfsFile() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(`${STORE_NAME}.gz`)
  } catch {}
}

// streams the blob through gzip, spilling to opfs when available so a large
// file never has to sit in memory just to learn its compressed size
export async function compressToStore(blob, onProgress) {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()

  const reader = blob.stream().getReader()
  let written = 0

  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      written += value.length
      await writer.write(value)
      if (onProgress) onProgress(written, blob.size)
    }
    await writer.close()
  })()

  const handle = await opfsFile()

  if (handle) {
    try {
      const writable = await handle.createWritable()
      await cs.readable.pipeTo(writable)
      await pump
      const file = await handle.getFile()
      return { blob: file, size: file.size, spilled: true }
    } catch {
      // fall through to the memory path
    }
  }

  const parts = []
  const drain = (async () => {
    const reader2 = cs.readable.getReader()
    while (true) {
      const { done, value } = await reader2.read()
      if (done) break
      parts.push(value)
    }
  })()

  await Promise.all([pump, drain])
  const out = new Blob(parts, { type: 'application/gzip' })
  return { blob: out, size: out.size, spilled: false }
}

export async function decompressBlob(blob, onProgress) {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()

  const reader = blob.stream().getReader()
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value)
    }
    await writer.close()
  })()

  const parts = []
  const drain = (async () => {
    const r = ds.readable.getReader()
    let total = 0
    while (true) {
      const { done, value } = await r.read()
      if (done) break
      total += value.length
      parts.push(value)
      if (onProgress) onProgress(total)
    }
  })()

  await Promise.all([pump, drain])
  return new Blob(parts)
}

export { removeOpfsFile }