import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AblyProvider from './AblyProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AblyProvider>
      <App />
    </AblyProvider>
  </StrictMode>,
)
