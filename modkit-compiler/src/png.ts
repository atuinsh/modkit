/**
 * The structure of a PNG file, checked without decoding its pixels.
 *
 * A PNG is an 8-byte signature, then chunks: a 4-byte big-endian length, a 4-byte type, that many
 * bytes of data, and a 4-byte CRC of the type and data. `IHDR` comes first and holds the width and
 * height, at least one `IDAT` holds the pixels, and `IEND` comes last. A file cut short or corrupted
 * breaks one of those, so fails here rather than in the harness that draws it.
 *
 * @module
 */

import { crc32 } from 'node:zlib'

const SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex')
const LENGTH_BYTES = 4
const TYPE_BYTES = 4
const CRC_BYTES = 4
const IHDR_BYTES = 13
const HEIGHT_AT = 4

interface Chunk {
  type: string
  data: Buffer
}

// The chunk at `at` in `bytes` and where the next one starts, or undefined when it is cut short or
// its CRC is wrong.
function chunkAt({
  bytes,
  at,
}: {
  bytes: Buffer
  at: number
}): { chunk: Chunk; next: number } | undefined {
  const typeAt = at + LENGTH_BYTES
  const dataAt = typeAt + TYPE_BYTES
  if (dataAt > bytes.length) return undefined
  const crcAt = dataAt + bytes.readUInt32BE(at)
  if (crcAt + CRC_BYTES > bytes.length) return undefined
  if (crc32(bytes.subarray(typeAt, crcAt)) !== bytes.readUInt32BE(crcAt)) return undefined
  const chunk = {
    type: bytes.toString('latin1', typeAt, dataAt),
    data: bytes.subarray(dataAt, crcAt),
  }
  return { chunk, next: crcAt + CRC_BYTES }
}

// The chunks of `bytes` after the signature, up to and including `IEND`, or undefined when the file
// ends before an `IEND` or holds a chunk that doesn't check out.
function chunksOf(bytes: Buffer): Chunk[] | undefined {
  const chunks: Chunk[] = []
  let at = SIGNATURE.length
  while (chunks.at(-1)?.type !== 'IEND') {
    const read = chunkAt({ bytes, at })
    if (read === undefined) return undefined
    chunks.push(read.chunk)
    at = read.next
  }
  return chunks
}

/** The pixel size of the PNG `bytes` hold, or undefined when they hold no whole, valid PNG. */
export function pngSizeOf(bytes: Buffer): { widthPx: number; heightPx: number } | undefined {
  if (!bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined
  const chunks = chunksOf(bytes)
  const [header] = chunks ?? []
  const isWhole =
    header?.type === 'IHDR' &&
    header.data.length === IHDR_BYTES &&
    chunks?.some((chunk) => chunk.type === 'IDAT') === true
  if (!isWhole) return undefined
  const widthPx = header.data.readUInt32BE(0)
  const heightPx = header.data.readUInt32BE(HEIGHT_AT)
  return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined
}
