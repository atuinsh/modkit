import type {
  Completion,
  CompletionRequest,
  Copied,
  Delivery,
  Failure,
  HarnessAdapter,
  Store,
  Surface,
} from '@atuin/modkit-target/host'

import { Clipboard } from './clipboard.ts'
import { ProcessRunner } from './run.ts'
import type { Servers } from './servers.ts'

/** Base dependencies required to construct a Node/Bun {@link HarnessAdapter}. */
export interface NodeHarnessInit {
  readonly sessionId: string
  readonly cwd: string | (() => string)
  readonly servers: Servers
  readonly store: Store
  readonly report: (failure: Failure) => void
  readonly signal?: AbortSignal
}

type NotifyFn = (text: string) => Delivery
type InjectFn = (text: string) => Promise<Delivery>
type CompleteFn = (request: CompletionRequest) => Promise<Completion>
type CopyFn = (text: string, options?: { surface?: Surface }) => Promise<Copied>

const DEFAULT_NO_MODEL = 'this harness gives a mod no model to call'

const DROP_NOTIFY: NotifyFn = () => 'dropped'
const DROP_INJECT: InjectFn = async () => 'dropped'
const DEFAULT_COMPLETE: CompleteFn = async () => ({
  isAnswered: false,
  reason: 'refused',
  detail: DEFAULT_NO_MODEL,
})
const DEFAULT_COPY: CopyFn = async (text) => Clipboard.system().copy(text)

/** Fluent builder for a Node/Bun {@link HarnessAdapter} with standard process, env, MCP, and clipboard defaults. */
export class NodeHarnessBuilder {
  readonly #init: NodeHarnessInit
  #notify: NotifyFn = DROP_NOTIFY
  #inject: InjectFn = DROP_INJECT
  #complete: CompleteFn = DEFAULT_COMPLETE
  #copy: CopyFn = DEFAULT_COPY

  constructor(init: NodeHarnessInit) {
    this.#init = init
  }

  /** Provide how the harness surfaces short notifications to the user. */
  withNotify(fn: NotifyFn): this {
    this.#notify = fn
    return this
  }

  /** Provide how the harness injects context into the model's conversation. */
  withInject(fn: InjectFn): this {
    this.#inject = fn
    return this
  }

  /** Provide how the harness runs standalone model completions. */
  withComplete(fn: CompleteFn): this {
    this.#complete = fn
    return this
  }

  /** Refuse standalone completions with a harness-specific diagnostic detail. */
  withModelRefusal(detail: string): this {
    this.#complete = async () => ({ isAnswered: false, reason: 'refused', detail })
    return this
  }

  /** Override the default system clipboard copy implementation. */
  withCopy(fn: CopyFn): this {
    this.#copy = fn
    return this
  }

  /** Build the configured {@link HarnessAdapter}. */
  build(): HarnessAdapter {
    const { sessionId, cwd, servers, store, report, signal } = this.#init
    const resolveCwd = typeof cwd === 'function' ? cwd : (): string => cwd
    const runner = new ProcessRunner({ cwd: resolveCwd, ...(signal !== undefined && { signal }) })
    return {
      session: { id: sessionId },
      cwd: async () => resolveCwd(),
      root: async () => runner.projectRoot(),
      env: async (name) => process.env[name],
      run: async (argv, options) => runner.run(argv, options),
      mcp: async (call) => servers.call(call),
      complete: this.#complete,
      copy: this.#copy,
      notify: this.#notify,
      inject: this.#inject,
      now: () => Date.now(),
      store,
      report,
    }
  }
}

/** Entry point for building a Node/Bun {@link HarnessAdapter}. */
export const NodeHarness: { readonly builder: (init: NodeHarnessInit) => NodeHarnessBuilder } = {
  builder: (init) => new NodeHarnessBuilder(init),
}
