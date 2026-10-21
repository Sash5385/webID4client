// Автономна збірка для перегляду без Firebase/роутера: три сторінки симулятора з вкладками.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SimPage from '../pages/SimPage'
import CrossingPage from '../pages/CrossingPage'
import QuizPage from '../pages/QuizPage'

const TABS = [
  { id: 'road', label: 'Дорога', C: SimPage },
  { id: 'cross', label: 'Перехрестя', C: CrossingPage },
  { id: 'quiz', label: 'Квіз', C: QuizPage },
]

function Demo() {
  const [tab, setTab] = useState('road')
  const Active = TABS.find((t) => t.id === tab)!.C
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#111' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, flex: '0 0 auto' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '8px 0', border: 'none', borderRadius: 8, fontWeight: 700, background: tab === t.id ? '#f59e0b' : '#2a2c33', color: tab === t.id ? '#111' : '#ddd' }}>{t.label}</button>
        ))}
      </div>
      {/* transform робить контейнер опорним для position:fixed усередині сторінок */}
      <div style={{ position: 'relative', flex: 1, transform: 'translateZ(0)', overflow: 'hidden' }}>
        <Active key={tab} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Demo />)
