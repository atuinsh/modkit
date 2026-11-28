import { genArrayFromRaw, genObjectFromValues, genString } from 'knitwork'

import type { ImageDecl } from '@atuin/modkit-compiler'

/**
 * The source of an expression building the `Images` map a target's runtime mounts a mod with,
 * from the PNGs the compiler read for its `<Img>`s.
 */
export const imagesSource = (images: readonly ImageDecl[]): string =>
  `new Map(${genArrayFromRaw(
    images.map(({ path, ...png }) => genArrayFromRaw([genString(path), genObjectFromValues(png)])),
  )})`
