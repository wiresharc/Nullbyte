import { ENC_CHUNK, deriveIVFor, chunkAADFor } from './encryption.js'

const TAU = ENC_CHUNK + 16

function concat(parts) {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function readHeaderFrom(bytes) {
  if (bytes.length < 8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, false) !== 0x4e423031) return null

  const length = view.getUint32(4, false)
  if (length > bytes.length - 8) return null

  try {
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)))
    return {
      name: meta.n || '',
      type: meta.t || '',
      compressed: meta.c === 1,
      consumed: 8 + length,
    }
  } catch {
    return null
  }
}

async function pullUntil(reader, want) {
  let have = new Uint8Array(0)
  while (have.length < want) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const merged = new Uint8Array(have.length + value.length)
    merged.set(have, 0)
    merged.set(value, have.length)
    have = merged
  }
  return have
}

// reads only the first sealed chunk so the caller can inspect the header first
async function sniff(response, cryptoKey, baseNonce) {
  const reader = response.body.getReader()
  const sealed = await pullUntil(reader, TAU)

  if (sealed.length < TAU) {
    if (!sealed.length) return { reader, prefix: sealed, header: null, firstPlain: null, single: true }
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deriveIVFor(baseNonce, 0), additionalData: chunkAADFor(0) },
      cryptoKey,
      sealed
    )
    const header = readHeaderFrom(new Uint8Array(plain))
    const firstPlain = header ? new Uint8Array(plain).subarray(header.consumed) : null
    return { reader, prefix: new Uint8Array(0), header, firstPlain, single: true }
  }

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deriveIVFor(baseNonce, 0), additionalData: chunkAADFor(0) },
    cryptoKey,
    sealed.subarray(0, TAU)
  )

  const header = readHeaderFrom(new Uint8Array(plain))
  const firstPlain = header ? new Uint8Array(plain).subarray(header.consumed) : null

  return { reader, prefix: sealed.subarray(TAU), header, firstPlain }
}

// continues decryption from wherever sniffing stopped, never holding more than one chunk
async function openEncryptedStream(reader, prefix, cryptoKey, baseNonce, onProgress, firstBytes) {
  let pending = new Uint8Array(prefix)
  let index = 1
  const queue = []
  if (firstBytes && firstBytes.length) queue.push(firstBytes)

  return {
    async *read() {
      while (true) {
        while (pending.length >= TAU) {
          const sealed = pending.subarray(0, TAU)
          const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: deriveIVFor(baseNonce, index), additionalData: chunkAADFor(index) },
            cryptoKey,
            sealed
          )
          queue.push(new Uint8Array(plain))
          if (onProgress) onProgress(index)
          index++
          pending = pending.subarray(TAU)
        }

        if (queue.length) {
          yield { bytes: queue.shift() }
          continue
        }

        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        const merged = new Uint8Array(pending.length + value.length)
        merged.set(pending, 0)
        merged.set(value, pending.length)
        pending = merged
      }

      if (pending.length) {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: deriveIVFor(baseNonce, index), additionalData: chunkAADFor(index) },
          cryptoKey,
          pending
        )
        yield { bytes: new Uint8Array(plain) }
      }
    },
  }
}

export { TAU, concat, readHeaderFrom, sniff, openEncryptedStream, pullUntil }