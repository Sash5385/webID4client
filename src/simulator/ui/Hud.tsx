import type { EventType } from '../engine/types'

export const EVENT_TEXT: Record<EventType, string> = {
  'ped-not-yielded': 'Не пропустили пішохода',
  'lc-no-signal': 'Перестроєння без поворотника',
  'lc-late-signal': 'Запізнілий поворотник',
  'lc-dangerous': 'Небезпечне перестроєння',
  'lc-out-of-road': 'Виїзд за межі смуги',
  speeding: 'Перевищення швидкості',
  collision: 'Аварія',
  finish: 'Фініш',
}

export const Hud = ({ kmh, message, errors, showErrors }: {
  kmh: number; message: string; errors: number; showErrors: boolean
}) => (
  <div style={{ position: 'absolute', top: 8, left: 8, right: 8, color: '#fff', pointerEvents: 'none', fontFamily: 'system-ui' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <b style={{ fontSize: 28, textShadow: '0 1px 3px #000' }}>{Math.round(kmh)} км/г</b>
      {showErrors && <b style={{ fontSize: 18, textShadow: '0 1px 3px #000' }}>Помилки: {errors}</b>}
    </div>
    {message && (
      <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(0,0,0,.6)', borderRadius: 8, fontSize: 14 }}>{message}</div>
    )}
  </div>
)
