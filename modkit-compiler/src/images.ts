/**
 * The PNGs a mod's `<Img>`s name, read from the mod's directory for its targets to embed.
 *
 * An `<Img>` names its PNG with a string literal, or a union of them, so every picture the mod can
 * draw is known before it runs. Each is checked here to be a PNG in the mod's directory, of a size
 * every harness takes, and its pixel size read from its header.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { diagnosticAt, type Diagnostic } from './diagnostics.ts'
import type { ImageDecl } from './ir.ts'
import { modkitExports } from './modkit.ts'
import {
  isStringLiteralType,
  isUnionType,
  resolvedSymbol,
  syntax,
  type Node,
  type Project,
  type TsSymbol,
  type Type,
} from './program.ts'

/** What reading a mod's `<Img>`s found: the PNGs to embed, and why any can't be. */
export interface ImagesRead {
  /** Sorted by path. */
  images: ImageDecl[]
  diagnostics: Diagnostic[]
}

type ImgElement = syntax.JsxSelfClosingElement | syntax.JsxOpeningElement

const BYTES_PER_MIB = 1_048_576

// Claude Code's Image takes a PNG of at most 2 MiB.
const MAX_PNG_MIB = 2

// Every PNG opens with these 8 bytes, then its IHDR chunk: a 4-byte length, `IHDR`, and the width
// and height as 4-byte big-endian integers.
const PNG_SIGNATURE = Buffer.from('89504E470D0A1A0A', 'hex')
const IHDR_AT = 12
const WIDTH_AT = 16
const HEIGHT_AT = 20
const HEADER_BYTES = 24

// The pixel size a PNG's header gives, or undefined when `bytes` are no PNG.
function pngSizeOf(bytes: Buffer): { widthPx: number; heightPx: number } | undefined {
  const isPng =
    bytes.length >= HEADER_BYTES &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) &&
    bytes.toString('latin1', IHDR_AT, WIDTH_AT) === 'IHDR'
  if (!isPng) return undefined
  const widthPx = bytes.readUInt32BE(WIDTH_AT)
  const heightPx = bytes.readUInt32BE(HEIGHT_AT)
  return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : undefined
}

function imgsIn({ project, img }: { project: Project; img: TsSymbol }): ImgElement[] {
  const found: ImgElement[] = []
  const visit = (node: Node): void => {
    if (
      (syntax.isJsxSelfClosingElement(node) || syntax.isJsxOpeningElement(node)) &&
      resolvedSymbol({ checker: project.checker, node: node.tagName })?.id === img.id
    ) {
      found.push(node)
    }
    node.forEachChild(visit)
  }
  for (const file of project.files) visit(file)
  return found
}

const isImageAttribute = (node: Node): node is syntax.JsxAttribute =>
  syntax.isJsxAttribute(node) && syntax.isIdentifier(node.name) && node.name.text === 'image'

// The strings `type` can be, when it is a string literal or a union of them.
function literalsOf(type: Type): string[] | undefined {
  const members = isUnionType(type) ? type.getTypes() : [type]
  const texts = members.flatMap((member) => (isStringLiteralType(member) ? [member.value] : []))
  return texts.length === members.length ? texts : undefined
}

// The paths the value `written` for an `image` attribute can be, when the build can know them.
function pathsIn({ project, written }: { project: Project; written: Node }): string[] | undefined {
  // The checker widens a JSX attribute's string to `string`, but not an expression's literal type.
  if (syntax.isStringLiteral(written)) return [written.text]
  const type = project.checker.getTypeAtLocation(written)
  return type === undefined ? undefined : literalsOf(type)
}

// The paths `element` names, or why the build can't know them.
function pathsOf({
  project,
  element,
}: {
  project: Project
  element: ImgElement
}): { paths: string[]; at: Node } | Diagnostic {
  const attribute = element.attributes.properties.find((one) => isImageAttribute(one))
  const value = attribute?.initializer
  const written = value !== undefined && syntax.isJsxExpression(value) ? value.expression : value
  const paths = written === undefined ? undefined : pathsIn({ project, written })
  if (paths !== undefined && written !== undefined) return { paths, at: written }
  const message =
    "<Img> names its image with a string literal, or a union of them: the build embeds each PNG a mod's <Img>s name"
  return diagnosticAt({ code: 'image', message, node: attribute ?? element })
}

const mibOf = (bytes: number): string => (bytes / BYTES_PER_MIB).toFixed(1)

// The file `path` names in `dir`, or why it names none there.
function fileIn({ dir, path }: { dir: string; path: string }): { file: string } | string {
  if (isAbsolute(path)) {
    return "an image is named by its path in the mod's directory, not by an absolute one"
  }
  const file = resolve(dir, path)
  const inside = relative(dir, file)
  if (inside === '..' || inside.startsWith(`..${sep}`)) {
    return `${path} is outside the mod's directory, which the build embeds images from`
  }
  return { file }
}

// The bytes of the file at `path` in `dir`, or why there are none to read.
function bytesAt({ dir, path }: { dir: string; path: string }): Buffer | string {
  const named = fileIn({ dir, path })
  if (typeof named === 'string') return named
  const { file } = named
  try {
    return readFileSync(file)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') return `the mod's directory has no ${path}`
    if (code === 'EISDIR') return `${path} is a directory, not a PNG`
    return `${path} can't be read: ${error instanceof Error ? error.message : String(error)}`
  }
}

// The image at `path`, or why it can't be embedded.
function imageAt({ dir, path }: { dir: string; path: string }): ImageDecl | string {
  const bytes = bytesAt({ dir, path })
  if (typeof bytes === 'string') return bytes
  if (bytes.length > MAX_PNG_MIB * BYTES_PER_MIB) {
    return `${path} is ${mibOf(bytes.length)} MiB, and a harness draws a PNG of at most ${MAX_PNG_MIB} MiB`
  }
  const size = pngSizeOf(bytes)
  if (size === undefined) return `${path} is not a PNG, the one format every harness draws`
  return { path, base64: bytes.toString('base64'), ...size }
}

/** Read each PNG the `<Img>`s of the mod in `dir` name, for its targets to embed. */
export function imagesIn({ project, dir }: { project: Project; dir: string }): ImagesRead {
  const img = modkitExports(project).find((symbol) => symbol.name === 'Img')
  if (img === undefined) return { images: [], diagnostics: [] }
  const named = imgsIn({ project, img }).map((element) => pathsOf({ project, element }))
  const read = new Map<string, ImageDecl | string>()
  const diagnostics = named.flatMap((one): Diagnostic[] => {
    if ('code' in one) return [one]
    return one.paths.flatMap((path) => {
      const image = read.get(path) ?? imageAt({ dir, path })
      read.set(path, image)
      if (typeof image !== 'string') return []
      const message = `<Img image="${path}">: ${image}`
      return [diagnosticAt({ code: 'image', message, node: one.at })]
    })
  })
  const images = [...read.values()].flatMap((image) => (typeof image === 'string' ? [] : [image]))
  return {
    images: images.toSorted((one, other) => one.path.localeCompare(other.path)),
    diagnostics,
  }
}
