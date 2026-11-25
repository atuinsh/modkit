import { defineConfig } from 'tsdown'

// `isolatedDeclarations` would select oxc, whose declarations drop the doc comments on union
// members and modules; tsgo keeps them.
const dts = { generator: 'tsgo' } as const

export default defineConfig([
  {
    cwd: 'packages/modkit',
    entry: {
      index: 'src/index.ts',
      'ui/hooks': 'src/ui/hooks/index.ts',
      'jsx-runtime': 'src/jsx-runtime.ts',
    },
    platform: 'neutral',
    dts,
  },
  {
    cwd: 'packages/compiler',
    entry: {
      index: 'src/index.ts',
    },
    dts,
  },
  {
    cwd: 'packages/targets/claude',
    entry: { 'codegen/index': 'src/codegen/index.ts' },
    tsconfig: 'src/codegen/tsconfig.json',
    dts,
  },
  {
    cwd: 'packages/targets/claude',
    entry: { 'runtime/index': 'src/runtime/index.ts' },
    tsconfig: 'src/runtime/tsconfig.json',
    platform: 'neutral',
    deps: { neverBundle: ['claude-code', 'modkit-claude:state', 'modkit-claude:env'] },
    dts,
  },
  {
    cwd: 'packages/cli',
    entry: { main: 'src/main.ts' },
  },
])
