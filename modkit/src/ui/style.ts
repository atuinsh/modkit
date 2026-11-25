/**
 * Shared style tokens (tones, hex colors, borders) and their Valibot schemas for UI primitives.
 *
 * @module
 */

import * as v from 'valibot'

const TONES = ['plain', 'dim', 'warning', 'success', 'error'] as const

/** Semantic color tone mapped onto each harness's active theme palette. */
export type Tone = (typeof TONES)[number]

/**
 * Six-digit hex color literal (`#rrggbb`).
 *
 * Unlike {@link Tone}, a hex color does not adapt to light or dark harness themes.
 */
export type Hex = `#${string}`

const BORDERS = ['single', 'round', 'double', 'bold', 'dashed'] as const

/** Border line style drawn around a stack container. */
export type Border = (typeof BORDERS)[number]

export const ToneSchema: v.GenericSchema<Tone> = v.picklist(TONES)
export const BorderSchema: v.GenericSchema<Border> = v.picklist(BORDERS)
export const NonNegIntSchema: v.GenericSchema<number> = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
)
export const HexSchema: v.GenericSchema<Hex> = v.custom<Hex>(
  (value): value is Hex => typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value),
  'expected a #rrggbb hex color',
)
