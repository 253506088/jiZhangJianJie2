import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('./prototypes/ui-v1/', import.meta.url)),
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist-prototype/', import.meta.url)),
    emptyOutDir: true,
  },
});
