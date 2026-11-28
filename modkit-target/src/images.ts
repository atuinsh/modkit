import { genArrayFromRaw, genObjectFromValues, genString } from 'knitwork'

import type { ImageDecl } from '@atuin/modkit-compiler'

/** Codegen bundle of compiled mod PNGs serialized into a runtime `Images` `Map` expression. */
export class ImageBundle {
  readonly #images: readonly ImageDecl[]

  constructor(images: readonly ImageDecl[]) {
    this.#images = images
  }

  /** Emit a JS expression constructing the runtime `Images` `Map` from these images. */
  toSource(): string {
    return `new Map(${genArrayFromRaw(
      this.#images.map(({ path, ...png }) =>
        genArrayFromRaw([genString(path), genObjectFromValues(png)]),
      ),
    )})`
  }
}
