import { Plugin, usePlugin } from '@opencode/plugin/tui'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { resolveImageRenderProtocol, SyntaxStyle, type RGBA } from '@opentui/core'
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
  type Accessor,
  type JSX,
} from 'solid-js'

import type { ViewJson } from '../contract.ts'
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
    fg: shared.color(span.fg),
    ...(span.bg !== undefined && { bg: shared.color(span.bg) }),
    ...(flow === 'line' && { flexShrink: 0, wrapMode: 'none' as const }),
  }
  const text = span.bold ? <b>{span.text}</b> : span.text
  return (
    <text {...props}>
      {span.href === undefined ? (
        text
      ) : (
        <a href={span.href}>
          <u>{text}</u>
        </a>
      )}
    </text>
  )
}

// Whether the terminal is known to open no links, so a pane spells out each link's URL.
const isLinkless = (ctx: Context): boolean => ctx.renderer.capabilities?.hyperlinks === false

// OpenTUI draws a picture with kitty's protocol or sixel where its probe of the terminal found one,
// and in half blocks otherwise; there the mod's fallback stands in for it.
function pictured({
  spec,
  shared,
  flow,
}: {
  spec: Extract<Spec, { tag: 'image' }>
  shared: Shared
  flow: Flow
}): JSX.Element {
  const { renderer } = shared.ctx
  const protocol = resolveImageRenderProtocol(
    'auto',
    renderer.capabilities,
    renderer.resolution !== null,
  )
  if (protocol === 'blocks') {
    return drawn({
      spec: { tag: 'text', spans: [{ text: spec.fallback, fg: { tone: 'plain' }, bold: false }] },
      shared,
      flow,
    })
  }
  return (
    <image
      source={`data:image/png;base64,${spec.png}`}
      protocol={protocol}
      width={spec.columns}
      height={spec.rows}
      {...lineProps(flow)}
    />
  )
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
    case 'image':
      return pictured({ spec, shared, flow })
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
          <For
            each={specsOf({
              nodes: pane().body,
              hasKeys: true,
              spellsUrls: isLinkless(props.shared.ctx),
            })}
          >
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
            <For each={specsOf({ nodes: status, hasKeys: false, spellsUrls: false })}>
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
  // The panel opens when a pane newly becomes the newest, and not again when the person moves to
  // another panel while it shows.
  let shown = ''
  createEffect(() => {
    const latest = shared.view().panes.at(-1)?.id ?? ''
    const isOurs = untrack(() => ui.panel.current()?.name === PANEL)
    if (latest !== '' && latest !== shown && !isOurs) ui.panel.open(PANEL)
    if (latest === '' && isOurs) ui.panel.close()
    shown = latest
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
    // Only the newest request's reply is drawn: an older one may be another session's, or stale.
    let asked = 0
    const refresh = async () => {
      asked += 1
      const mine = asked
      const id = session()
      const next =
        id === undefined ? EMPTY_VIEW : viewOf(await clientOf(ctx).view({ sessionID: id }))
      if (mine === asked) setView(next)
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
