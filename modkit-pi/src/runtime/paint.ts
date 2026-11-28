import { getMarkdownTheme, type Theme, type ThemeColor } from '@earendil-works/pi-coding-agent'
import { getCapabilities, hyperlink, Markdown, parseColor } from '@earendil-works/pi-tui'

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

/**
 * Paint drawing with `theme`: hotkeys beside buttons when `hasKeys`, and pictures when
 * `drawsImages`.
 *
 * A link is colored and underlined as pi's markdown draws one. Where the terminal opens no links it
 * draws as its text, followed by its URL unless `isLine`, as the footer has no room for one.
 */
export function paintOf({
  theme,
  hasKeys,
  isLine,
  drawsImages,
}: {
  theme: Theme
  hasKeys: boolean
  isLine: boolean
  drawsImages: boolean
}): Paint {
  const opensLinks = getCapabilities().hyperlinks
  return {
    text: ({ text, tone, bold, color, background, href }) => {
      const fg = textColor({ tone, color }) ?? (href === undefined ? undefined : 'mdLink')
      const styled = theme.style(text, {
        ...(fg !== undefined && { fg }),
        ...(background !== undefined && { bg: parseColor(background) }),
        ...(bold && { bold: true }),
        ...(href !== undefined && { underline: true }),
      })
      return href === undefined || !opensLinks ? styled : hyperlink(styled, href)
    },
    spellsUrls: !opensLinks && !isLine,
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
