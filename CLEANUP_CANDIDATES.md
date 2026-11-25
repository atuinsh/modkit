# Library Replacement Candidates

Audit of hand-written functionality in `modkit/` and which libraries replaced it or remain as
candidates. Constraints across this workspace:

- `typescript@7.0.2` (`typescript/unstable/*` / `tsgo` RPC API).
- `packages/modkit` and `packages/targets/claude/src/runtime` bundle with `platform: 'neutral'` and
  zero Node built-ins (`import/no-nodejs-modules`).
- `packages/targets/claude/src/runtime` is checked by `claude plugin validate`.
- `pnpm-workspace.yaml` enforces `minimumReleaseAge: 4320`, `trustPolicy: no-downgrade`, and
  `blockExoticSubdeps: true`.

## Adopted

- **`citty`** (`packages/cli/src/main.ts`) -- replaced manual `node:util` `parseArgs`, `USAGE`,
  `EXIT_USAGE`, and subcommand dispatch with `defineCommand` (`build`, `dev`) and `runMain`.
- **`chokidar`** (`packages/cli/src/main.ts`) -- replaced raw `node:fs.watch(..., { recursive: true })`
  and `isWithin` with `watch(..., { ignoreInitial: true, ignored })`.
- **`es-toolkit`** (`packages/cli/src/main.ts`, `packages/modkit/src/runtime/values.ts`,
  `packages/targets/claude/src/runtime/index.ts`) -- subpath imports `es-toolkit/function`
  (`debounce`) and `es-toolkit/predicate` (`isPlainObject`) replaced manual watch debounce timers,
  `isPlain`, and duplicate `isRecord` checks.
- **`valibot`** (`packages/modkit/src/{ui,modparts,harness,hooks,runtime}`,
  `packages/compiler/src/{manifest,plugin}.ts`) -- replaced hand-written prop guards, verdict /
  followup / resource-option validation, and `package.json` / `author` object validation.
- **`canonicalize`** (`packages/compiler/src/shape.ts`) -- replaced hand-written `stableJson` with
  RFC 8785 deterministic JSON serialization.
- **`scule`** (`packages/compiler/src/options.ts`, `packages/targets/claude/src/codegen/state.ts`)
  -- `splitByCase`/`upperFirst` replaced the `titleOf` regex and `pascalCase` replaced `typeNameOf`.
- **`@sindresorhus/slugify`** (`packages/compiler/src/names.ts`) -- replaced regex slugification in
  `pluginNameOf` and added Unicode transliteration.
- **`knitwork`** (`packages/targets/claude/src/codegen/{state,env}.ts`) -- replaced manual ESM
  imports, string quoting, object literal building, and `declare module 'claude-code'` augmentation
  assembly (`genImport`, `genString`, `genObjectFromValues`, `genAugmentation`).
- **`tsdown`** (`tsdown.config.ts`, `package.json`) -- added `pnpm run build` emitting JS + `.d.ts`
  for all four workspace packages.

## Remaining candidates

- **`p-queue`** (`10.0.0`, 0 deps) in `packages/cli/src/main.ts` -- could replace the 3-line
  `last = last.then(...)` build serializer in `dev()`.
- **`read-pkg`** (`10.1.0`, wraps `normalize-package-data` `9.0.0`) in
  `packages/compiler/src/manifest.ts` -- could replace the `AUTHOR_LINE` regex in `authorOf` if
  strict npm semver/field normalization is desired.

## Keep hand-written (and why)

1. **JSX runtime, renderer, and hooks (`packages/modkit/src/{jsx-runtime.ts,runtime/,hooks/}`)**
   - `preact`, `react-reconciler`, and `solid-js` are poor fits: modkit renders synchronously into a
     multi-bucket data IR (`Rendered`), state hooks are keyed by compiler-injected persistent
     `StateSite` descriptors rather than fiber hook indices, and `react-reconciler` drags React +
     `scheduler` into every bundled plugin without bundled TS types.
2. **TypeScript 7 AST/type analysis (`packages/compiler/src/{program,types,sites,options,literals}.ts`)**
   - `ts-morph` and `ts-json-schema-generator` target TypeScript 5.x's in-process `ts.TypeChecker`,
     not TypeScript 7's `tsgo` RPC API (`typescript/unstable/sync`).
3. **Coalescing resource scheduler (`packages/modkit/src/hooks/scheduler.ts`)**
   - `p-queue` and `p-limit` run FIFO tasks rather than coalescing N concurrent refresh requests
     into at most one follow-up fetch (`again = true`).
4. **Pane state machine (`packages/modkit/src/runtime/panes.ts`) & Claude runtime glue (`packages/targets/claude/src/runtime/*`)**
   - Small domain state machine (40 lines) and `claude plugin validate`-constrained adapters where
     extra indirection can break static analysis of `$.noun.method(...)` and `on(...)`.
