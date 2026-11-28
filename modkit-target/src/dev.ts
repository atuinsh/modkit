/**
 * What a target tells `modkit dev`, which runs each target's harness on the mod's build in a dekit
 * task of its own and brings it onto each rebuild.
 *
 * @module
 */

/** The environment `modkit dev` runs in, which the harnesses it starts inherit. */
export type Env = Readonly<Record<string, string | undefined>>

/** A session of a harness that `modkit dev` keeps across restarts of the harness. */
export interface DevSession {
  /** A UUID, which a target spells the way its harness spells a session's id. */
  id: string
}

/** What `modkit dev` runs in a harness's task: `claude --plugin-dir dist/claude-code`. */
export interface DevCommand {
  /** The program, looked up on `PATH`: `claude`. */
  program: string
  args: readonly string[]
  /** Variables set over the environment `modkit dev` runs in. */
  env: Readonly<Record<string, string>>
}

/** How a rebuild reaches a running harness. */
export type Reload =
  /** The harness watches the build and loads a rebuild itself, as Claude Code does `--plugin-dir`. */
  | 'watched'
  /** `modkit dev` restarts the harness on the same session. */
  | 'restarted'

/** What a target's `dev` is handed. */
export interface DevInput {
  /** The directory the target's build is in, `<out>/<target name>`. */
  out: string
  /** The harness's name for the package the build wrote, `atuin-mod`. */
  plugin: string
  /** A directory the harness may keep files in while `modkit dev` runs. */
  scratch: string
  /** Whether the mod has a status, which a harness may show in place of the user's own. */
  hasStatus: boolean
  env: Env
}

/**
 * The harness `modkit dev` runs a target's build in, for as long as `modkit dev` runs.
 *
 * Disposing it undoes what {@link DevHarness.built} changed outside the build.
 */
export interface DevHarness extends AsyncDisposable {
  /** How a rebuild reaches the harness once it runs. */
  readonly reload: Reload
  /** The paths under the build the harness writes itself, relative to it: a change to them is no new build. */
  readonly writes: readonly string[]
  /** The command that starts the harness on the build, in `session`. */
  readonly command: (session: DevSession) => DevCommand
  /** Ready the harness for the build just written, before it starts or restarts on it. */
  readonly built: () => Promise<void>
}

/**
 * What a target says of its harness: the {@link DevHarness} it runs as, but that a harness writing
 * nothing into its build and readying nothing outside it leaves those parts out.
 */
export type DevSpec = Pick<DevHarness, 'reload' | 'command'> &
  Partial<Pick<DevHarness, 'writes' | 'built' | typeof Symbol.asyncDispose>>
