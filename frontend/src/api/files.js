function readBatch(reader) {
  return new Promise((resolve) => {
    reader.readEntries(resolve, () => resolve([]))
  })
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
    out.push(Object.assign(file, { webkitRelativePath: prefix + entry.name }))
    return
  }

  if (!entry.isDirectory) return

  const reader = entry.createReader()
  const nextPrefix = prefix + entry.name + '/'
  let batch = []
  do {
    batch = await readBatch(reader)
    for (const child of batch) {
      await walkEntry(child, nextPrefix, out)
    }
  } while (batch.length > 0)
}

// directories dragged in only expose themselves through this legacy api, and the
// entries have to be requested synchronously before the event goes away
export async function filesFromDrop(dataTransfer) {
  const out = []

  const entries = []
  const items = dataTransfer.items ? [...dataTransfer.items] : []
  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
    if (entry) entries.push(entry)
  }

  for (const entry of entries) {
    await walkEntry(entry, '', out)
  }

  if (out.length) return out
  return dataTransfer.files ? [...dataTransfer.files] : []
}

export function mergeFiles(existing, incoming) {
  const seen = new Set(existing.map((f) => f.webkitRelativePath || f.name))
  const merged = [...existing]

  for (const file of incoming) {
    const key = file.webkitRelativePath || file.name
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(file)
  }

  return merged
}

export function totalSize(files) {
  return files.reduce((sum, f) => sum + f.size, 0)
}