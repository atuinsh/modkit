import type { ArtifactWriter } from './defined-target.ts'

/** Something that emits generated JavaScript or TypeScript source text. */
export interface SourceEmitter {
  readonly emitSource: () => string
}

/** A virtual module resolved by specifier `id` during bundling. */
export interface VirtualModule extends SourceEmitter {
  readonly id: string
}

/** Something that emits one or more build artifacts through an {@link ArtifactWriter}. */
export interface ArtifactEmitter {
  readonly emitTo: (emit: ArtifactWriter) => void
}
