import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'lucide-react',
      'motion',
      'leaflet',
      'react-leaflet',
      'recharts',
      'react-markdown'
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (!normalized.includes('/node_modules/')) return;
          if (normalized.includes('/node_modules/react/') || normalized.includes('/node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // lucide-react is deliberately NOT forced into a chunk. Naming it
          // here collects every icon used anywhere in the app — including ones
          // reached only from lazy destinations like Vazi, MasterAdmin, and
          // Weather — into a single chunk the entry HTML preloads, so the whole
          // icon surface was paid for at first paint. Letting the icons split
          // with their consumers moved 28.5 KB off the critical path for +0.3%
          // total JS spread across lazily-loaded chunks.
          if (normalized.includes('/node_modules/motion/')) {
            return 'vendor-motion';
          }
        },
      },
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/worktrees/**',
      'tests/postgres/**',
      'e2e/**',
    ],
  },
  server: {
    port: 3000,
    strictPort: true,
  }
});
