import { getMarkdownTheme, type Theme, type ThemeColor } from '@earendil-works/pi-coding-agent'
import { Markdown, parseColor } from '@earendil-works/pi-tui'

import type { Hex, Tone } from '@atuin/modkit-target/host'

import { PICK_MARK, type Paint } from './lines'
import { pictureLines } from './pictures'

const TONE_COLORS: Readonly<Record<Tone, ThemeColor>> = {
  plain: 'text',
  dim: 'dim',
  warning: 'warning',
  success: 'success',
  error: 'error',
}

const textColor = ({
  tone,
  color,
}: {
  tone: Tone
  color: Hex | undefined
}): ReturnType<typeof parseColor> | ThemeColor | undefined => {
  if (color !== undefined) return parseColor(color)
  return tone === 'plain' ? undefined : TONE_COLORS[tone]
}

const borderColor = (tone: Tone | undefined): ThemeColor =>
  tone === undefined || tone === 'plain' ? 'border' : TONE_COLORS[tone]

export function paintOf({
  theme,
  hasKeys,
  drawsImages,
}: {
  theme: Theme
  hasKeys: boolean
  drawsImages: boolean
}): Paint {
  return {
    text: ({ text, tone, bold, color, background }) => {
      const fg = textColor({ tone, color })
      return theme.style(text, {
        ...(fg !== undefined && { fg }),
        ...(background !== undefined && { bg: parseColor(background) }),
        ...(bold && { bold: true }),
      })
    },
    border: ({ tone, text }) => theme.fg(borderColor(tone), text),
    button: ({ label, hotkey, isPicked }) => {
      const name = theme.fg('accent', isPicked ? theme.bold(`${PICK_MARK} ${label}`) : label)
      return hasKeys && hotkey !== undefined
        ? `${theme.fg('accent', theme.bold(hotkey))} ${name}`
        : name
    },
    markdown: ({ text, width }) => new Markdown(text, 0, 0, getMarkdownTheme()).render(width),
    image: (image) => (drawsImages ? pictureLines(image) : undefined),
  }
}
