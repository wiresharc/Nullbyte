const CHUNK_SIZE = 4 * 1024 * 1024;
const HEADER_MAGIC = 0x4e423031;

export async function generateKeyMaterial() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const baseNonce = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  return { keyBytes, baseNonce, cryptoKey };
}

// derive unique iv per chunk using chunk index
function deriveIV(baseNonce, chunkIndex) {
  const iv = new Uint8Array(baseNonce);
  const view = new DataView(iv.buffer);
  view.setUint32(8, chunkIndex, false);
  return iv;
}

function chunkAAD(chunkIndex) {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, chunkIndex, false);
  return aad;
}

export function buildHeader(name, type) {
  const meta = new TextEncoder().encode(JSON.stringify({ n: name || '', t: type || '' }));
  const out = new Uint8Array(8 + meta.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, HEADER_MAGIC, false);
  view.setUint32(4, meta.length, false);
  out.set(meta, 8);
  return out;
}

export function concatChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function readHeader(bytes) {
  if (bytes.length < 8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== HEADER_MAGIC) return null;

  const length = view.getUint32(4, false);
  if (length > bytes.length - 8) return null;

  try {
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
    return { name: meta.n || '', type: meta.t || '', data: bytes.subarray(8 + length) };
  } catch {
    return null;
  }
}

export async function encryptFile(file, cryptoKey, baseNonce, onProgress, fileName, fileType) {
  const source = fileName === undefined
    ? file
    : new Blob([buildHeader(fileName, fileType), file]);

  const totalChunks = Math.max(1, Math.ceil(source.size / CHUNK_SIZE));
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * CHUNK_SIZE;
    const slice = source.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();

    const iv = deriveIV(baseNonce, i);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: chunkAAD(i) },
      cryptoKey,
      buffer
    );

    chunks.push(new Uint8Array(encrypted));

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }

  return chunks;
}

export async function decryptFile(encryptedBuffer, cryptoKey, baseNonce, onProgress) {
  const encryptedChunkSize = CHUNK_SIZE + 16;
  const totalChunks = Math.ceil(encryptedBuffer.byteLength / encryptedChunkSize);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * encryptedChunkSize;
    const end = Math.min(offset + encryptedChunkSize, encryptedBuffer.byteLength);
    const chunk = encryptedBuffer.slice(offset, end);

    const iv = deriveIV(baseNonce, i);

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: chunkAAD(i) },
        cryptoKey,
        chunk
      );
      chunks.push(new Uint8Array(decrypted));
    } catch (e) {
      throw new Error(`decryption failed at chunk ${i}: wrong key or corrupted file`);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }

  return chunks;
}

export function exportKey(keyBytes, baseNonce) {
  const combined = new Uint8Array(44);
  combined.set(keyBytes, 0);
  combined.set(baseNonce, 32);
  return btoa(String.fromCharCode(...combined));
}

export function importKey(base64Key) {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  if (raw.length !== 44) {
    throw new Error('malformed decryption key');
  }

  const keyBytes = raw.slice(0, 32);
  const baseNonce = raw.slice(32);

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  ).then(cryptoKey => ({ cryptoKey, baseNonce }));
}

export function downloadBlob(chunks, filename, mimeType = 'application/octet-stream') {
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}