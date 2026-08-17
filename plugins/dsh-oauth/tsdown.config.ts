import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'client': 'src/client/index.tsx',
  },
  outDir: 'lib',
  format: 'esm',
  dts: false,
  clean: true,
  target: 'node22',
  platform: 'node',
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: [
      'cordis',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-timeout',
      '@deepseek-ai/schemastery',
      '@earendil-works/pi-ai',
      'react',
      'react-dom',
      'node:crypto',
      'node:http',
      'node:net',
      'node:child_process',
    ],
  },
})
