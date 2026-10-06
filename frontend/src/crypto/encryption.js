const CHUNK_SIZE = 4 * 1024 * 1024;

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

export async function encryptFile(file, cryptoKey, baseNonce, onProgress) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const chunks = [];

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * CHUNK_SIZE;
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();

    const iv = deriveIV(baseNonce, i);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
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
  // each chunk is CHUNK_SIZE + 16 bytes for the gcm tag
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
        { name: 'AES-GCM', iv },
        cryptoKey,
        chunk
      );
      chunks.push(new Uint8Array(decrypted));
    } catch (e) {
      throw new Error(`decryption failed at chunk ${i}: ${e.message}`);
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
