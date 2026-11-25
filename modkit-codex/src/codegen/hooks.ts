import { HOOK_TOOL, serverNameOf, SHELL_TOOL } from '../runtime/names.ts'

const ASKING_TIMEOUT_S = 600

const field = (name: string): string => `\${${name}}`

const COMMON = { session_id: field('session_id'), cwd: field('cwd') }

const PRE_TOOL_USE = {
  ...COMMON,
  tool_name: field('tool_name'),
  tool_input: field('tool_input'),
  tool_use_id: field('tool_use_id'),
  permission_mode: field('permission_mode'),
}

const POST_TOOL_USE = {
  ...COMMON,
  tool_name: field('tool_name'),
  tool_input: field('tool_input'),
  tool_response: field('tool_response'),
  tool_use_id: field('tool_use_id'),
  transcript_path: field('transcript_path'),
}

function matcherOf(tool: string): string {
  // Codex compares a matcher of letters, digits and `_` as written, and reads any other as an
  // unanchored regex, which `mcp__my-server__x` would match more than one tool with.
  if (/^\w+$/u.test(tool)) return tool
  return `^${tool.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}$`
}

interface Hook {
  type: 'mcp_tool'
  server: string
  tool: string
  input: Readonly<Record<string, string>>
  timeout?: number
}

const hookOf = ({
  plugin,
  event,
  input,
  timeout,
}: {
  plugin: string
  event: string
  input: Readonly<Record<string, string>>
  timeout?: number
}): Hook => ({
  type: 'mcp_tool',
  server: serverNameOf(plugin),
  tool: HOOK_TOOL,
  input: { event, ...input },
  ...(timeout !== undefined && { timeout }),
})

export function hooksJsonOf({
  plugin,
  hasBeforeShell,
  tools,
}: {
  plugin: string
  hasBeforeShell: boolean
  tools: { before: readonly string[]; after: readonly string[] }
}): unknown {
  const on = (event: string): { hooks: Hook[] }[] => [
    { hooks: [hookOf({ plugin, event, input: COMMON })] },
  ]
  const preHook = hookOf({
    plugin,
    event: 'PreToolUse',
    input: PRE_TOOL_USE,
    timeout: ASKING_TIMEOUT_S,
  })
  const postHook = hookOf({ plugin, event: 'PostToolUse', input: POST_TOOL_USE })
  const before = [
    ...(hasBeforeShell ? [SHELL_TOOL] : []),
    ...tools.before.filter((tool) => tool !== SHELL_TOOL),
  ]
  // The shell is always hooked after: a query that refreshes on `shell.after` needs it even in a
  // mod with no `afterShell`.
  const after = [SHELL_TOOL, ...tools.after.filter((tool) => tool !== SHELL_TOOL)]
  return {
    hooks: {
      SessionStart: on('SessionStart'),
      UserPromptSubmit: on('UserPromptSubmit'),
      ...(before.length > 0 && {
        PreToolUse: before.map((tool) => ({ matcher: matcherOf(tool), hooks: [preHook] })),
      }),
      PostToolUse: after.map((tool) => ({ matcher: matcherOf(tool), hooks: [postHook] })),
      Stop: on('Stop'),
    },
  }
}
