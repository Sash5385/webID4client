import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { initErrorReporter } from './errorReporter.js'
import './styles/tokens.css'
import './styles/global.css'
import './styles/fog.css'

initErrorReporter()

// Після деплою старі файли застосунку зникають із сервера: відкрита (або закешована) стара версія просить «чанк», якого вже немає,
// і замість JS отримує index.html (помилка «text/html is not a valid JavaScript MIME type»). Тоді просто перезавантажуємо сторінку
// на нову версію. Один раз за 30 с, щоб не зациклитись, якщо сервер справді недоступний.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('dp_chunk_reload') || 0)
    if (Date.now() - last < 30000) return
    sessionStorage.setItem('dp_chunk_reload', String(Date.now()))
  } catch { /* сховище недоступне */ }
  // preventDefault тут не викликаємо: інакше import() повертає undefined і React.lazy падає з «reading 'default'»
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
