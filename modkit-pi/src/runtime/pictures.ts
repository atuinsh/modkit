/**
 * Pictures drawn with pi-tui's own image support, as the kitty image lines its renderer tracks.
 *
 * A picture's lines are as wide as its box, so a row lays it beside text as it would a word: kitty's
 * protocol leaves the cursor where it was, and spaces carry it across the cells under the picture.
 *
 * @module
 */

import { allocateImageId, getCapabilities, renderImage } from '@earendil-works/pi-tui'

import type { ImgNode, Png } from '@atuin/modkit-target/host'

// Kitty keeps a picture by its id, so each PNG keeps one per box across renders: pi-tui then places
// it again rather than sending its bytes again.
const KITTY_IDS = new WeakMap<Png, Map<string, number>>()

function kittyIdOf({ png, box }: { png: Png; box: string }): number {
  const ids = KITTY_IDS.get(png) ?? new Map<string, number>()
  KITTY_IDS.set(png, ids)
  const id = ids.get(box) ?? allocateImageId()
  ids.set(box, id)
  return id
}

function kittyLines({ png, columns, rows }: { png: Png; columns: number; rows: number }): string[] {
  const dimensions = { widthPx: png.widthPx, heightPx: png.heightPx }
  const drawn = renderImage(png.base64, dimensions, {
    maxWidthCells: columns,
    maxHeightCells: rows,
    imageId: kittyIdOf({ png, box: `${columns}x${rows}` }),
    moveCursor: false,
  })
  if (drawn === null) return []
  const blank = ' '.repeat(drawn.columns)
  const under = Array.from({ length: drawn.rows - 1 }, () => blank)
  return [`${drawn.sequence}${blank}`, ...under]
}

/** The lines drawing `node` at most `width` columns wide, or undefined where the terminal can't. */
export function pictureLines({
  node,
  width,
}: {
  node: ImgNode
  width: number
}): string[] | undefined {
  const box = { png: node.png, columns: Math.min(node.columns, width), rows: node.rows }
  switch (getCapabilities().images) {
    case 'kitty':
      return kittyLines(box)
    // TODO(markovejnovic): draw iTerm2 pictures too. pi-tui counts the cursor-up an iTerm2 image
    // line starts with as text, so a row can't lay one beside other nodes at its true width.
    case 'iterm2':
    case null:
      break
  }
  return undefined
}
