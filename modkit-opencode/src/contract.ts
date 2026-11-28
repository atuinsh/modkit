import * as v from 'valibot'

import {
  HarnessTools,
  NATIVE,
  type Border,
  type Capabilities,
  type DroppedSupport,
  type Hex,
  type LoweredSupport,
  type NativeSupport,
  type Tone,
} from '@atuin/modkit-target/host'

export interface OpencodeCapabilities extends Capabilities {
  readonly status: LoweredSupport
  readonly commands: NativeSupport
  readonly panes: LoweredSupport
  readonly beforeShell: NativeSupport
  readonly afterShell: NativeSupport
  readonly beforeTool: NativeSupport
  readonly afterTool: NativeSupport
  readonly toolCards: DroppedSupport
}

export const OPENCODE_CAPABILITIES: OpencodeCapabilities = {
  status: {
    kind: 'lowered',
    why: "opencode's footer draws a button as text, which can't be pressed",
  },
  commands: NATIVE,
  panes: {
    kind: 'lowered',
    why: 'opencode shows one pane at a time, the newest, and presses a button only by its hotkey',
  },
  beforeShell: NATIVE,
  afterShell: NATIVE,
  beforeTool: NATIVE,
  afterTool: NATIVE,
  toolCards: { kind: 'dropped', why: "opencode draws nothing under a tool's row" },
}

export const OPENCODE_TOOLS: HarnessTools = new HarnessTools({
  harness: 'opencode',
  shell: 'shell',
  builtin: [
    'edit',
    'execute',
    'glob',
    'grep',
    'question',
    'read',
    'skill',
    'subagent',
    'webfetch',
    'websearch',
    'write',
  ],
})

export type NodeJson =
  | string
  | { kind: 'Text'; tone: Tone; bold: boolean; color?: Hex; background?: Hex; children: NodeJson[] }
  | { kind: 'Link'; href: string; children: NodeJson[] }
  | {
      kind: 'Column' | 'Row'
      gap: number
      border?: Border
      borderTone?: Tone
      paddingX?: number
      paddingY?: number
      children: NodeJson[]
    }
  | { kind: 'Button'; id: string; hotkey?: string; label: string }
  | { kind: 'Markdown'; text: string }
  /** A PNG, base64, over a box of `columns` by `rows` cells. */
  | { kind: 'Img'; png: string; columns: number; rows: number; fallback: string }

export interface PaneJson {
  id: string
  title: string
  body: NodeJson[]
}

export interface ViewJson {
  statuses: NodeJson[][]
  panes: PaneJson[]
  commands: { name: string; description: string }[]
}

const ToneSchema = v.picklist(['plain', 'dim', 'warning', 'success', 'error'])
const BorderSchema = v.picklist(['single', 'round', 'double', 'bold', 'dashed'])
const HexSchema = v.custom<Hex>(
  (value): value is Hex => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/u.test(value),
)

const NodeJsonSchema: v.GenericSchema<unknown, NodeJson> = v.lazy(() =>
  v.union([
    v.string(),
    v.object({
      kind: v.literal('Text'),
      tone: ToneSchema,
      bold: v.boolean(),
      color: v.exactOptional(HexSchema),
      background: v.exactOptional(HexSchema),
      children: v.array(NodeJsonSchema),
    }),
    v.object({
      kind: v.literal('Link'),
      href: v.string(),
      children: v.array(NodeJsonSchema),
    }),
    v.object({
      kind: v.picklist(['Column', 'Row']),
      gap: v.number(),
      border: v.exactOptional(BorderSchema),
      borderTone: v.exactOptional(ToneSchema),
      paddingX: v.exactOptional(v.number()),
      paddingY: v.exactOptional(v.number()),
      children: v.array(NodeJsonSchema),
    }),
    v.object({
      kind: v.literal('Button'),
      id: v.string(),
      hotkey: v.exactOptional(v.string()),
      label: v.string(),
    }),
    v.object({ kind: v.literal('Markdown'), text: v.string() }),
    v.object({
      kind: v.literal('Img'),
      png: v.string(),
      columns: v.number(),
      rows: v.number(),
      fallback: v.string(),
    }),
  ]),
)

const PaneJsonSchema: v.GenericSchema<unknown, PaneJson> = v.object({
  id: v.string(),
  title: v.string(),
  body: v.array(NodeJsonSchema),
})

const ViewJsonSchema: v.GenericSchema<unknown, ViewJson> = v.object({
  statuses: v.array(v.array(NodeJsonSchema)),
  panes: v.array(PaneJsonSchema),
  commands: v.array(v.object({ name: v.string(), description: v.string() })),
})

export const EMPTY_VIEW: ViewJson = { statuses: [], panes: [], commands: [] }

/** Validate an RPC `view` response against {@link ViewJsonSchema}, falling back to {@link EMPTY_VIEW}. */
export function parseViewJson(raw: unknown): ViewJson {
  const parsed = v.safeParse(ViewJsonSchema, raw)
  return parsed.success ? parsed.output : EMPTY_VIEW
}

// A JSON Schema, which opencode takes as an open record.
interface Text {
  readonly [key: string]: unknown
  readonly type: 'string'
}

interface Input<Keys extends string> {
  readonly [key: string]: unknown
  readonly type: 'object'
  readonly properties: Readonly<Record<Keys | 'sessionID', Text>>
  readonly required: readonly string[]
}

interface AnyObject {
  readonly [key: string]: unknown
  readonly type: 'object'
}

interface Method<Keys extends string> {
  readonly input: Input<Keys>
  readonly output: AnyObject
}

export interface Contract {
  readonly id: string
  readonly methods: {
    readonly view: Method<never>
    readonly press: Method<'button'>
    readonly run: Method<'command'>
    readonly close: Method<'pane'>
  }
  readonly events: {
    readonly changed: { readonly schema: Input<never> }
    readonly notified: { readonly schema: Input<'text'> }
  }
}

const TEXT: Text = { type: 'string' }

const ANY_OBJECT: AnyObject = { type: 'object' }

const SESSION: Input<never> = {
  type: 'object',
  properties: { sessionID: TEXT },
  required: ['sessionID'],
}

const sessionAnd = <Key extends string>(properties: Readonly<Record<Key, Text>>): Input<Key> => ({
  type: 'object',
  properties: { ...SESSION.properties, ...properties },
  required: ['sessionID', ...Object.keys(properties)],
})

export const contractOf = (plugin: string): Contract => ({
  id: `${plugin}-mod`,
  methods: {
    view: { input: SESSION, output: ANY_OBJECT },
    press: { input: sessionAnd({ button: TEXT }), output: ANY_OBJECT },
    run: { input: sessionAnd({ command: TEXT }), output: ANY_OBJECT },
    close: { input: sessionAnd({ pane: TEXT }), output: ANY_OBJECT },
  },
  events: {
    changed: { schema: SESSION },
    notified: { schema: sessionAnd({ text: TEXT }) },
  },
})
