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

export type { Failure, HarnessAdapter, Phase, Store, Stored } from './harness/index'
export { textOf } from './runtime/element'
export { mount, type Mounted, type View } from './runtime/mount'
export { dismissed, nextShown, NOTHING_SHOWN, type PaneChange, type Shown } from './runtime/panes'
export type { CommandView, PaneView } from './runtime/render'
export type { ButtonNode, MarkdownNode, StackNode, TextNode, UiNode } from './ui/index'
