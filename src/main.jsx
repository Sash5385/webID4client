// Діагностика слотів: ?slotdebug=1 запам'ятовується до того, як роутер прибере параметр
try { if (new URLSearchParams(window.location.search).has('slotdebug')) localStorage.setItem('slotdebug', '1') } catch {}
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
