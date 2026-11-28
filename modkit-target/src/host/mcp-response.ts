import type { McpResult } from '@atuin/modkit'

import { isPlainRecord } from './values.ts'

function joinTextBlocks(content: unknown): string {
  const blocks: readonly unknown[] = Array.isArray(content) ? content : []
  return blocks
    .flatMap((block) => {
      if (!isPlainRecord(block)) return []
      const { type, text } = block
      return type === 'text' && typeof text === 'string' ? [text] : []
    })
    .join('\n')
}

/** Parsed MCP `tools/call` response normalized to a modkit {@link McpResult}. */
export class McpResponse {
  readonly #result: McpResult

  private constructor(result: McpResult) {
    this.#result = result
  }

  /** Parse a raw MCP tool response payload into a {@link McpResponse}. */
  static parse(raw: unknown): McpResponse {
    if (!isPlainRecord(raw)) {
      return new McpResponse({ isOk: false, reason: 'the server answered something not MCP' })
    }
    const { content, isError, structuredContent: structured } = raw
    const text = joinTextBlocks(content)
    if (isError === true) {
      return new McpResponse({
        isOk: false,
        reason: text === '' ? 'the tool reported a failure' : text,
      })
    }
    return new McpResponse({ isOk: true, text, ...(structured !== undefined && { structured }) })
  }

  toResult(): McpResult {
    return this.#result
  }
}
