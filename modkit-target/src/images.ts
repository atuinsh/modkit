import type { ImageDecl } from '@atuin/modkit-compiler'

/**
 * The source of an expression building the `Images` map a target's runtime mounts a mod with,
 * from the PNGs the compiler read for its `<Img>`s.
 */
export function imagesSource(images: readonly ImageDecl[]): string {
  const entries = images.map(({ path, base64, widthPx, heightPx }) => [
    path,
    { base64, widthPx, heightPx },
  ])
  return `new Map(${JSON.stringify(entries)})`
}
