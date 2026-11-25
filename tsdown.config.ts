import { defineConfig } from 'tsdown'

// `isolatedDeclarations` would select oxc, whose declarations drop the doc comments on union
// members and modules; tsgo keeps them.
const dts = { generator: 'tsgo' } as const

export default defineConfig([
  {
    cwd: 'modkit',
    entry: {
      index: 'src/index.ts',
      'ui/hooks': 'src/ui/hooks/index.ts',
      'jsx-runtime': 'src/jsx-runtime.ts',
    },
    platform: 'neutral',
    dts,
  },
  {
    cwd: 'modkit-compiler',
    entry: {
      index: 'src/index.ts',
    },
    dts,
  },
  {
    cwd: 'modkit-claude-code',
    entry: { 'codegen/index': 'src/codegen/index.ts' },
    tsconfig: 'src/codegen/tsconfig.json',
    dts,
  },
  {
    cwd: 'modkit-claude-code',
    entry: { 'runtime/index': 'src/runtime/index.ts' },
    tsconfig: 'src/runtime/tsconfig.json',
    platform: 'neutral',
    deps: { neverBundle: ['claude-code', 'modkit-claude:state', 'modkit-claude:env'] },
    dts,
  },
  {
    cwd: 'modkit-cli',
    entry: { main: 'src/main.ts' },
  },
])
