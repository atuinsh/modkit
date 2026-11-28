/**
 * What a harness target runs a mod with: {@link mount}, the {@link HarnessAdapter} it implements,
 * and the {@link UiNode} trees it draws.
 *
 * `@atuin/modkit-target` is this entry's one importer: its `ModkitTargetRuntime` mounts a mod, and
 * `@atuin/modkit-target/host` gives targets the rest. A mod's compiler rejects a mod that imports
 * it.
 *
 * @module
 */

export type { Failure, HarnessAdapter, Phase, Store, Stored } from './harness/index.ts'
export { textOf } from './runtime/element.ts'
export { mount, type Mounted, type View } from './runtime/mount.ts'
export { PaneId } from './runtime/pane-id.ts'
export {
  dismissed,
  nextShown,
  NOTHING_SHOWN,
  type PaneChange,
  type Shown,
} from './runtime/panes.ts'
export type { CommandView, PaneView } from './runtime/render.ts'
export type {
  ButtonNode,
  Images,
  ImgNode,
  LinkNode,
  MarkdownNode,
  Png,
  StackNode,
  TextNode,
  UiNode,
} from './ui/index.ts'
