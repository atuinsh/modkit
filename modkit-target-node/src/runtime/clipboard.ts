import { spawn } from 'node:child_process'
import { once } from 'node:events'

import type { Copied } from '@atuin/modkit-target/host'

const CLIPBOARDS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ['pbcopy'],
  win32: ['clip'],
}

const NO_CLIPBOARD: Copied = { isCopied: false, reason: 'no-clipboard' }

function clipboardCommand(): readonly string[] | undefined {
  const fixed = CLIPBOARDS[process.platform]
  if (fixed !== undefined) return fixed
  if (process.env['WAYLAND_DISPLAY'] !== undefined) return ['wl-copy']
  if (process.env['DISPLAY'] !== undefined) return ['xclip', '-selection', 'clipboard']
  return undefined
}

export async function copy(text: string): Promise<Copied> {
  const [command, ...args] = clipboardCommand() ?? []
  if (command === undefined) return NO_CLIPBOARD
  try {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    child.stdin.end(text)
    const closed: readonly unknown[] = await once(child, 'close')
    return closed[0] === 0 ? { isCopied: true } : NO_CLIPBOARD
  } catch {
    return NO_CLIPBOARD
  }
}
