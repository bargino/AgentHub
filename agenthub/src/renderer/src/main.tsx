import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './services/theme'
import { initPanelWidth } from './components/ui/panelWidth'
import { initI18n } from './i18n'

initI18n()
initTheme()
initPanelWidth()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
