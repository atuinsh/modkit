/**
 * Target-independent intermediate representation (IR) emitted by the compiler and consumed by
 * harness target code generators.
 *
 * @module
 */

import type { Diagnostic } from './diagnostics.ts'
import type { Modparts } from './modparts.ts'
import type { Shape } from './shape.ts'

/** Mod author metadata parsed from `package.json`. */
export interface Author {
  name: string
  email?: string
  url?: string
}

/** Package identity fields read from the mod's `package.json`. */
export interface ModInfo {
  name: string
  version: string
  description: string
  author?: Author
}

export type StateKind = 'state' | 'query'

export interface StateDecl {
  id: string
  kind: StateKind
  /** Short hash of `shape`, stored alongside persisted values to detect type changes. */
  tag: string
  /** Canonical JSON {@link Shape} of the stored value. */
  shape: Shape
}

/** Value kind, optional enum choices, and optional static default for a mod setting. */
export type OptionKind =
  | { kind: 'string'; choices?: readonly string[]; default?: string }
  | { kind: 'strings'; default?: readonly string[] }
  | { kind: 'number'; default?: number }
  | { kind: 'boolean'; default?: boolean }

export type OptionDecl = OptionKind & {
  name: string
  /** Display label from `@title`, or derived from `name` (e.g. `atuinPath` -> `'Atuin path'`). */
  title: string
  /** Setting description extracted from the prop's JSDoc comment. */
  description: string
  /** True when the prop is neither optional nor defaulted, requiring configuration before load. */
  isRequired: boolean
  /** True when annotated with `@sensitive`, indicating the harness should store the value securely. */
  isSensitive: boolean
}

/** Resolved hook subscriptions and UI flags derived from the mod's parts and queries. */
export interface HookNeeds {
  /** Tools to intercept before running, including `'Bash'` when `beforeShell` is declared. */
  before: string[]
  /** Tools to intercept after running, including `'Bash'` when `afterShell` or a query exists. */
  after: string[]
  /** Tools whose rows draw mod cards. */
  cards: string[]
  /** True when the mod renders any status row. */
  hasStatus: boolean
  /** True when the mod defines any pane or command (commands may toggle a pane). */
  hasPanes: boolean
}

/** A PNG an `<Img>` names, read from the mod's directory for a target to embed. */
export interface ImageDecl {
  /** The path the `<Img>` names it by, in the mod's directory: `art/logo.png`. */
  path: string
  /** The PNG's bytes, base64. */
  base64: string
  widthPx: number
  heightPx: number
}

/** Output of `compile()`: either the full compiled mod IR or a list of diagnostics. */
export type Compiled =
  | {
      isOk: true
      mod: ModInfo
      /** Resolved absolute path to `mod.tsx`. */
      entry: string
      state: StateDecl[]
      options: OptionDecl[]
      /** Sorted unique environment variable names referenced by `harness.env()` calls. */
      env: string[]
      tools: { before: string[]; after: string[]; cards: string[] }
      /** The PNGs the mod's `<Img>`s name, sorted by path. */
      images: ImageDecl[]
      modparts: Modparts
      hooks: HookNeeds
    }
  | { isOk: false; diagnostics: Diagnostic[] }
