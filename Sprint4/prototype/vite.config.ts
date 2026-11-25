import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The demo is served through a Cloudflare tunnel, so the Host header Vite
  // sees is the tunnel's hostname, not localhost — allow any host rather than
  // pin one, since a quick tunnel's hostname changes every restart. Safe here:
  // fully static, read-only, no backend (see prior conversation).
  preview: {
    allowedHosts: true,
  },
})
