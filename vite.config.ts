import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const privateExports =
  fileURLToPath(new URL('./exports/', import.meta.url)).replaceAll('\\', '/') + '**';

export default defineConfig({
  plugins: [react()],
  // Match the supported WebView floor instead of Vite's moving browser baseline.
  build: { target: 'chrome100', cssTarget: 'chrome100' },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/.tools/**',
        '**/.local/**',
        '**/analysis/**',
        '**/android/**',
        '**/artifacts/**',
        '**/prototypes/**',
      ],
    },
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,p12,pfx,jks,keystore}',
        '**/.git/**',
        '**/.local/**',
        '**/.tools/**',
        '**/analysis/**',
        '**/private-data/**',
        '**/import-samples/**',
        '**/backups/**',
        privateExports,
      ],
    },
  },
});
