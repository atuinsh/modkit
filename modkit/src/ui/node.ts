import type { ButtonNode } from './button'
import type { ImgNode } from './img'
import type { MarkdownNode } from './markdown'
import type { StackNode } from './stack'
import type { TextNode } from './text'

/** Resolved UI tree node produced by the renderer and consumed by harness targets. */
export type UiNode = string | TextNode | StackNode | ButtonNode | MarkdownNode | ImgNode
