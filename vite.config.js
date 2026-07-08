import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { classifyExpense } from './api/_classify-core.js'

// Serves /api/classify during `npm run dev`, mirroring the Vercel function
// so AI categorisation also works locally (it used to always fall back to "Other").
function classifyDev(apiKey) {
  return {
    name: 'classify-dev-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/classify', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          let category = 'other'
          try {
            category = await classifyExpense(JSON.parse(body || '{}'), apiKey)
          } catch {
            // fall back to "other"
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ category }))
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      classifyDev(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'Expense Tracker',
          short_name: 'Expenses',
          description: 'Personal expense tracker with AI categorisation',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
  }
})
