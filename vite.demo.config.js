import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: process.env.DEMO_OUT, emptyOutDir: true, minify: true,
    lib: { entry: 'src/simulator/demo/main.tsx', formats: ['iife'], name: 'SimDemo', fileName: () => 'demo.js' },
  },
})
