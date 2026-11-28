import * as v from 'valibot'

import { primitive, type Component } from '../runtime/element.ts'

/** A PNG a mod's build embeds: its bytes, base64, and its size in pixels. */
export interface Png {
  base64: string
  widthPx: number
  heightPx: number
}

/** The PNGs a mod's build embeds, by the path its `Img`s name each with. */
export type Images = ReadonlyMap<string, Png>

/** Resolved `Img` element: its PNG and the box of terminal cells the picture spans. */
export interface ImgNode {
  kind: 'Img'
  png: Png
  columns: number
  rows: number
  /** What a target draws in the picture's place where it, or the terminal, draws no picture. */
  fallback: string
}

export interface ImgProps {
  /** The PNG's path in the mod's directory, a string literal the build embeds: `art/logo.png`. */
  image: string
  /** What shows where the harness or the terminal draws no picture, such as `😂`. */
  fallback: string
  /** Terminal columns the picture spans, 1 to 255. Defaults to what `rows` and its shape give. */
  columns?: number
  /** Terminal rows the picture spans, 1 to 255. Defaults to what `columns` gives, or one. */
  rows?: number
}

// The most cells Claude Code's Image spans each way.
const MAX_CELLS = 255

// A terminal cell is about twice as tall as it is wide.
const CELL_ASPECT = 2

const CellsSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_CELLS))

const cellsOf = (cells: number): number => Math.min(MAX_CELLS, Math.max(1, Math.round(cells)))

// The box a picture of `png`'s shape spans: the sides given, the other one from its shape, and one
// row with neither, as the line of text it stands in would be.
function boxOf({
  png,
  columns,
  rows,
}: {
  png: Png
  columns: number | undefined
  rows: number | undefined
}): { columns: number; rows: number } {
  const columnsPerRow = (png.widthPx / png.heightPx) * CELL_ASPECT
  if (columns !== undefined) return { columns, rows: rows ?? cellsOf(columns / columnsPerRow) }
  const tall = rows ?? 1
  return { columns: cellsOf(tall * columnsPerRow), rows: tall }
}

/**
 * A PNG of the mod's, drawn with the terminal's image protocol where the harness has one, and as
 * `fallback` where it has none.
 *
 * The harness picks the protocol: kitty's, iTerm2's or sixel, whichever it and the terminal
 * speak. `image` is a string literal, or a union of them, so the build can find and embed each PNG.
 */
export const Img: Component<ImgProps> = primitive({
  name: 'Img',
  schema: v.object({
    image: v.string(),
    fallback: v.string(),
    columns: v.optional(CellsSchema),
    rows: v.optional(CellsSchema),
  }),
  node: ({ props: { image, fallback, columns, rows }, scope }) => {
    const png = scope.images.get(image)
    if (png === undefined) {
      throw new Error(
        `<Img image="${image}">: the build embedded no ${image}, as it embeds only the PNGs an <Img> names with a string literal`,
      )
    }
    return { kind: 'Img', png, ...boxOf({ png, columns, rows }), fallback }
  },
  text: ({ node }) => node.fallback,
})
