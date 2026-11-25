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
      modparts: Modparts
    }
  | { isOk: false; diagnostics: Diagnostic[] }
