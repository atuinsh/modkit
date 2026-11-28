import type { Border, Hex, Tone } from '@atuin/modkit-target/host'

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
