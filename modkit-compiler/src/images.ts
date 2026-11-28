/**
 * The PNGs a mod's `<Img>`s name, read from the mod's directory for its targets to embed.
 *
 * An `<Img>` names its PNG with a string literal, or a union of them, so every picture the mod can
 * draw is known before it runs. Each is checked here to be in the mod's directory, links followed,
 * of a size every harness takes, and decoded whole with fast-png, so a PNG cut short or holding
 * broken pixels fails the build rather than the harness. `Img` is only ever written as a JSX tag:
 * passed around as a value, it could draw a PNG the build never saw.
 *
 * @module
 */

import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { decode } from 'fast-png'
import isPathInside from 'is-path-inside'
import prettyBytes from 'pretty-bytes'

import { ModDiagnostic, type Diagnostic } from './diagnostics.ts'
import { pathsOf } from './img-paths.ts'
import type { ImageDecl } from './ir.ts'
import { ModkitSymbols } from './modkit.ts'
import { syntax, type Node, type TsProject, type TsSymbol } from './program.ts'

/** What reading a mod's `<Img>`s found: the PNGs to embed, and why any can't be. */
export interface ImagesRead {
  /** Sorted by path. */
  images: ImageDecl[]
  diagnostics: Diagnostic[]
}

type ImgElement = syntax.JsxSelfClosingElement | syntax.JsxOpeningElement

// Claude Code's Image takes a PNG of at most 2 MiB.
const MAX_PNG_BYTES = 2_097_152

function nodesIn<T extends Node>({
  project,
  is,
}: {
  project: TsProject
  is: (node: Node) => node is T
}): T[] {
  const found: T[] = []
  const visit = (node: Node): void => {
    if (is(node)) found.push(node)
    node.forEachChild(visit)
  }
  for (const file of project.files) visit(file)
  return found
}

const isElement = (node: Node): node is ImgElement =>
  syntax.isJsxSelfClosingElement(node) || syntax.isJsxOpeningElement(node)

const isImg = ({
  project,
  img,
  node,
}: {
  project: TsProject
  img: TsSymbol
  node: Node
}): boolean => project.resolveSymbol(node)?.id === img.id

const imgsIn = ({ project, img }: { project: TsProject; img: TsSymbol }): ImgElement[] =>
  nodesIn({ project, is: isElement }).filter((element) =>
    isImg({ project, img, node: element.tagName }),
  )

// The names the mod's files bind Img to: its own, and each import or export that renames it.
function namesOf({ project, img }: { project: TsProject; img: TsSymbol }): Set<string> {
  const specifiers = nodesIn({
    project,
    is: (node) => syntax.isImportSpecifier(node) || syntax.isExportSpecifier(node),
  })
  const renamed = specifiers.filter((one) => isImg({ project, img, node: one.name }))
  return new Set(['Img', ...renamed.map((one) => one.name.text)])
}

// Whether `reference` names a JSX element's tag, as `Img` or `ui.Img` does in `<ui.Img />`.
function isTagName(reference: syntax.Identifier): boolean {
  const { parent } = reference
  const tag =
    syntax.isPropertyAccessExpression(parent) && parent.name === reference ? parent : reference
  const holder = tag.parent
  return (isElement(holder) || syntax.isJsxClosingElement(holder)) && holder.tagName === tag
}

function isInType(node: Node): boolean {
  for (let at = node.parent; !syntax.isSourceFile(at); at = at.parent) {
    if (syntax.isTypeQueryNode(at)) return true
  }
  return false
}

// Whether `reference` to Img leaves the build nothing it can't read: a JSX tag, which it reads the
// image of, or an import, an export or a type, which draw nothing.
const isReadable = (reference: syntax.Identifier): boolean =>
  syntax.isImportSpecifier(reference.parent) ||
  syntax.isExportSpecifier(reference.parent) ||
  isTagName(reference) ||
  isInType(reference)

// Each use of Img as a value, such as `const Picture = Img`, which would draw PNGs the build can't
// see the names of.
function valueUsesIn({ project, img }: { project: TsProject; img: TsSymbol }): Diagnostic[] {
  const names = namesOf({ project, img })
  const message =
    '<Img> is written as a JSX tag, never passed around as a value: the build embeds the PNG each <Img> tag names'
  return nodesIn({ project, is: syntax.isIdentifier })
    .filter((one) => names.has(one.text) && !isReadable(one) && isImg({ project, img, node: one }))
    .map((node) => ModDiagnostic.at({ code: 'image', message, node }))
}

const sizeText = (bytes: number): string => prettyBytes(bytes, { binary: true })

// The directory itself is left to reading it, which says it is a directory.
const isOutside = ({ dir, file }: { dir: string; file: string }): boolean =>
  file !== dir && !isPathInside(file, dir)

// The file `path` names in `dir`, links followed, or why it names none there. Throws what reading
// the links throws, such as when there is no file.
function fileIn({ dir, path }: { dir: string; path: string }): { file: string } | string {
  if (isAbsolute(path)) {
    return "an image is named by its path in the mod's directory, not by an absolute one"
  }
  const named = resolve(dir, path)
  if (isOutside({ dir, file: named })) {
    return `${path} is outside the mod's directory, which the build embeds images from`
  }
  // A link in the mod's directory can lead out of it, and the build would embed what it leads to.
  const file = realpathSync(named)
  if (isOutside({ dir: realpathSync(dir), file })) {
    return `${path} links outside the mod's directory, which the build embeds images from`
  }
  return { file }
}

function unreadOf({ error, path }: { error: unknown; path: string }): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  if (code === 'ENOENT') return `the mod's directory has no ${path}`
  if (code === 'EISDIR') return `${path} is a directory, not a PNG`
  return `${path} can't be read: ${error instanceof Error ? error.message : String(error)}`
}

// The bytes of the file at `path` in `dir`, or why there are none to read.
function bytesAt({ dir, path }: { dir: string; path: string }): Buffer | string {
  try {
    const named = fileIn({ dir, path })
    return typeof named === 'string' ? named : readFileSync(named.file)
  } catch (error) {
    return unreadOf({ error, path })
  }
}

// The pixel size of the PNG `bytes` hold, decoded whole, or what decoding them failed on.
function pngSizeOf(bytes: Buffer): { widthPx: number; heightPx: number } | string {
  try {
    const { width, height } = decode(bytes, { checkCrc: true })
    return { widthPx: width, heightPx: height }
  } catch (error) {
    return Error.isError(error) ? error.message : String(error)
  }
}

// The image at `path`, or why it can't be embedded.
function imageAt({ dir, path }: { dir: string; path: string }): ImageDecl | string {
  const bytes = bytesAt({ dir, path })
  if (typeof bytes === 'string') return bytes
  if (bytes.length > MAX_PNG_BYTES) {
    return `${path} is ${sizeText(bytes.length)}, and a harness draws a PNG of at most ${sizeText(MAX_PNG_BYTES)}`
  }
  const size = pngSizeOf(bytes)
  if (typeof size === 'string') {
    return `${path} is not a whole PNG, the one format every harness draws (fast-png: ${size})`
  }
  return { path, base64: bytes.toBase64(), ...size }
}

/** Read each PNG the `<Img>`s of the mod in `dir` name, for its targets to embed. */
export function imagesIn({ project, dir }: { project: TsProject; dir: string }): ImagesRead {
  const img = new ModkitSymbols(project).exports().find((symbol) => symbol.name === 'Img')
  if (img === undefined) return { images: [], diagnostics: [] }
  const named = imgsIn({ project, img }).map((element) => pathsOf({ project, element }))
  const read = new Map<string, ImageDecl | string>()
  const unread = named.flatMap((one): Diagnostic[] => {
    if ('code' in one) return [one]
    return [...one].flatMap(([path, at]) => {
      const image = read.get(path) ?? imageAt({ dir, path })
      read.set(path, image)
      if (typeof image !== 'string') return []
      const message = `<Img image="${path}">: ${image}`
      return [ModDiagnostic.at({ code: 'image', message, node: at })]
    })
  })
  const images = [...read.values()].flatMap((image) => (typeof image === 'string' ? [] : [image]))
  return {
    images: images.toSorted((one, other) => one.path.localeCompare(other.path)),
    diagnostics: [...valueUsesIn({ project, img }), ...unread],
  }
}
