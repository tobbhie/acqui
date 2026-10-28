import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@acqui/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'zod',
      'qrcode',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    // The browser only talks to this origin. /api/* is forwarded to the Acqui API with the prefix stripped,
    // so session cookies stay first-party. Set ACQUI_API_PROXY_TARGET if the API is not on localhost:8080.
    proxy: {
      '/api': {
        target: process.env.ACQUI_API_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
