import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// ESM-safe __dirname. package.json is "type": "module", so the bare
// __dirname is undefined; derive it from import.meta.url instead. This keeps
// the "@" alias resolvable even after Vite reloads the config in response to
// tsconfig changes (when __dirname injection can be skipped).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
