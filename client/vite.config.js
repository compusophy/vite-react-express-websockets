import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'healthcheck.railway.app',
      '.railway.app',
      '.up.railway.app'
    ]
  }
})
