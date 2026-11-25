import { Plugin, usePlugin } from '@opencode/plugin/tui'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { SyntaxStyle, type RGBA } from '@opentui/core'
import { createEffect, createSignal, For, onCleanup, Show, type Accessor, type JSX } from 'solid-js'

import type { ViewJson } from '../contract'
import { EMPTY_VIEW, hotkeysIn, specsOf, viewOf, type Paint, type Span, type Spec } from './draw.js'
import { CONTRACT, PLUGIN } from './mod.js'

const PANEL = `${PLUGIN}.pane`

type Context = Plugin.Context

const clientOf = (ctx: Context) => ctx.client.rpc(CONTRACT)

interface Shared {
  ctx: Context
  view: Accessor<ViewJson>
  session: Accessor<string | undefined>
  color: (paint: Paint) => string | RGBA
  syntax: SyntaxStyle
}

const colorOf =
  (ctx: Context) =>
  (paint: Paint): string | RGBA => {
    if ('hex' in paint) return paint.hex
    const { text, border } = ctx.theme
    switch (paint.tone) {
      case 'plain':
        return text.base
      case 'dim':
        return text.muted
      case 'accent':
        return text.action.primary.base
      case 'border':
        return border.base
      case 'warning':
      case 'success':
      case 'error':
        break
    }
    return text.feedback[paint.tone].base
  }

type Flow = 'wrap' | 'line'

const lineProps = (flow: Flow) => (flow === 'line' ? { flexShrink: 0 } : {})

function spanned({ span, shared, flow }: { span: Span; shared: Shared; flow: Flow }): JSX.Element {
  const props = {
    ...(span.fg !== undefined && { fg: shared.color(span.fg) }),
    ...(span.bg !== undefined && { bg: shared.color(span.bg) }),
    ...(flow === 'line' && { flexShrink: 0, wrapMode: 'none' as const }),
  }
  return <text {...props}>{span.bold ? <b>{span.text}</b> : span.text}</text>
}

const bordered = ({ spec, shared }: { spec: Extract<Spec, { tag: 'box' }>; shared: Shared }) =>
  spec.border === undefined
    ? {}
    : { border: true, borderStyle: spec.border.style, borderColor: shared.color(spec.border.color) }

function drawn({
  spec,
  shared,
  flow = 'wrap',
}: {
  spec: Spec
  shared: Shared
  flow?: Flow
}): JSX.Element {
  switch (spec.tag) {
    case 'text':
      return (
        <box flexDirection="row" {...lineProps(flow)}>
          <For each={spec.spans}>{(span) => spanned({ span, shared, flow })}</For>
        </box>
      )
    case 'box':
      return (
        <box
          flexDirection={spec.flexDirection}
          gap={spec.gap}
          paddingLeft={spec.padding.left}
          paddingRight={spec.padding.right}
          paddingTop={spec.padding.top}
          paddingBottom={spec.padding.bottom}
          {...bordered({ spec, shared })}
          {...lineProps(flow)}
        >
          <For each={spec.children}>{(child) => drawn({ spec: child, shared, flow })}</For>
        </box>
      )
    case 'markdown':
      break
  }
  return <markdown content={spec.content} syntaxStyle={shared.syntax} />
}

const newest = (shared: Shared) => shared.view().panes.at(-1)

function usePaneKeys(shared: Shared): void {
  const plugin = usePlugin()
  const mod = () => clientOf(shared.ctx)
  plugin.keymap.layer(() => {
    const id = shared.session()
    const pane = newest(shared)
    if (id === undefined || pane === undefined) return { commands: [] }
    return {
      commands: [
        {
          id: `${PLUGIN}.pane.close`,
          bind: 'escape',
          run: () => {
            void mod().close({ sessionID: id, pane: pane.id })
          },
        },
        ...[...hotkeysIn(pane.body)].map(([hotkey, button]) => ({
          id: `${PLUGIN}.pane.press.${hotkey}`,
          bind: hotkey,
          run: () => {
            void mod().press({ sessionID: id, button })
          },
        })),
      ],
    }
  })
}

function Pane(props: { panel: PanelInput; shared: Shared }) {
  usePaneKeys(props.shared)
  return (
    <Show when={newest(props.shared)}>
      {(pane) => (
        <box
          border
          borderStyle="rounded"
          borderColor={props.shared.color({ tone: props.panel.focused ? 'success' : 'border' })}
          title={pane().title}
          paddingLeft={1}
          paddingRight={1}
        >
          <For each={specsOf({ nodes: pane().body, hasKeys: true })}>
            {(spec) => drawn({ spec, shared: props.shared })}
          </For>
        </box>
      )}
    </Show>
  )
}

function Statuses(props: { shared: Shared }) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <For each={props.shared.view().statuses}>
        {(status) => (
          <box flexDirection="row" flexShrink={0}>
            <For each={specsOf({ nodes: status, hasKeys: false })}>
              {(spec) => drawn({ spec, shared: props.shared, flow: 'line' })}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function commandKeys(shared: Shared): void {
  const { ctx } = shared
  ctx.keymap.layer(() => ({
    mode: 'global',
    commands: shared.view().commands.map((command) => ({
      id: `${PLUGIN}.command.${command.name}`,
      title: command.description,
      slash: { name: command.name },
      palette: true,
      run: async () => {
        const id = shared.session()
        if (id === undefined) return
        const said: unknown = await clientOf(ctx).run({ sessionID: id, command: command.name })
        const text =
          typeof said === 'object' && said !== null && 'text' in said ? String(said.text) : ''
        if (text !== '') ctx.ui.toast.show({ message: text })
      },
    })),
  }))
}

function followPanes(shared: Shared): void {
  const { ui } = shared.ctx
  createEffect(() => {
    const isOurs = ui.panel.current()?.name === PANEL
    const hasPane = shared.view().panes.length > 0
    if (hasPane && !isOurs) ui.panel.open(PANEL)
    if (!hasPane && isOurs) ui.panel.close()
  })
}

function listen({ shared, refresh }: { shared: Shared; refresh: () => Promise<void> }): void {
  const { ctx, session } = shared
  clientOf(ctx).events.on('changed', (event) => {
    if (event.data['sessionID'] === session()) void refresh()
  })
  clientOf(ctx).events.on('notified', (event) => {
    const { sessionID, text } = event.data
    // A notice for a session not on screen offers to open it.
    ctx.ui.toast.show({
      message: String(text),
      ...(sessionID !== session() && { sessionID: String(sessionID) }),
    })
  })
}

export default Plugin.define({
  id: `${PLUGIN}-mod-tui`,
  setup: (ctx) => {
    const [view, setView] = createSignal(EMPTY_VIEW)
    const [session, setSession] = createSignal<string>()
    const shared: Shared = {
      ctx,
      view,
      session,
      color: colorOf(ctx),
      syntax: SyntaxStyle.create(ctx.renderer.nativeScene),
    }
    const refresh = async () => {
      const id = session()
      setView(id === undefined ? EMPTY_VIEW : viewOf(await clientOf(ctx).view({ sessionID: id })))
    }
    listen({ shared, refresh })
    ctx.ui.slot({ append: 'prompt.footer.status', render: () => <Statuses shared={shared} /> })
    ctx.ui.slot({
      append: 'session.panel',
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <Pane panel={panel} shared={shared} />
        </Show>
      ),
    })
    ctx.ui.slot({
      append: 'app',
      render: () => {
        createEffect(() => {
          const route = ctx.ui.router.current()
          setSession(route.type === 'session' ? route.sessionID : undefined)
          void refresh()
        })
        followPanes(shared)
        commandKeys(shared)
        onCleanup(() => {
          shared.syntax.destroy()
        })
        return null
      },
    })
  },
})
