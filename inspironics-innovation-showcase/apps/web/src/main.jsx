import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '#app/App.jsx'
import { baseUrl, env } from '#shared/config'
import { registerServiceWorker } from '#shared/lib/registerServiceWorker.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/*
      Every in-app path is relative to where the app is mounted. Standalone that
      is '/', behind the Apex gateway it is '/showcase/' — so the router learns
      it from the same place the asset URLs do rather than hard-coding either.
    */}
    <BrowserRouter basename={baseUrl}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

// the app shell offline (production builds only; see scripts/serviceWorker.mjs)
registerServiceWorker({ base: baseUrl, enabled: env.isProd })
