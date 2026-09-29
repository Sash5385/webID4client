// Єдині правила блокування / звільнення timeslots під запис.
//
// Мета: після скасування запису день виглядає РІВНО так, як до нього.
//  - блокування: позиція, якої не існувало в сітці дня, створюється лише під
//    запис і одразу позначається phantom:true (проміжні :00/:30 всередині
//    багатогодинного запису);
//  - звільнення: phantom-позицію видаляємо; справжню (яка існувала) повертаємо
//    вільною зі ВСІМА її власними полями (durMin тощо); позицію, якої вже
//    немає в дні, НЕ створюємо — інакше повторне (паралельне) звільнення
//    воскрешало б видалені phantom-и як окремі 30-хв слоти.
// Обидві функції ідемпотентні: клієнт, сервер і повторний виклик дають
// однаковий результат у будь-якому порядку.

const pad2 = (n) => String(n).padStart(2, '0')

export const slotIdAt = (min) => `slot${pad2(Math.floor(min / 60))}${pad2(min % 60)}`
export const slotTimeAt = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`

// Документ вважається існуючим, лише якщо це справжній слот (а не залишок
// на кшталт самого лише viewing).
export const slotExists = (node) =>
  !!node && typeof node === 'object' && (node.available !== undefined || !!node.time)

// day — знімок timeslots/{date} (або {}); prefix — напр. `timeslots/${date}/`.
export function blockRangeUpdates(day, prefix, startMin, durMin, opts = {}) {
  const { bookingStart = false, step = 30, extra = null } = opts
  const upd = {}
  for (let i = 0; i < durMin; i += step) {
    const min = startMin + i
    const id = slotIdAt(min)
    if (!slotExists(day?.[id])) upd[`${prefix}${id}/phantom`] = true
    upd[`${prefix}${id}/available`] = false
    upd[`${prefix}${id}/time`] = slotTimeAt(min)
    if (bookingStart) upd[`${prefix}${id}/bookingStart`] = i === 0
    if (extra) for (const [k, v] of Object.entries(extra)) upd[`${prefix}${id}/${k}`] = v
  }
  return upd
}

// Проходимо по ВСІХ документах дня, що лежать усередині часу запису, а не по
// кроку 30 хв: клієнт блокує з кроком зі своїх налаштувань (може бути 10 хв),
// і phantom на :40/:50 інакше лишались би "зайнятими" і ховали справжні слоти.
// skipRange {start,end} — діапазон, який не чіпаємо (напр. нове місце при
// переносі запису, де ці позиції одразу знову блокуються).
export function restoreRangeUpdates(day, prefix, startMin, durMin, opts = {}) {
  const { extra = null, skipRange = null } = opts
  const endMin = startMin + durMin
  const upd = {}
  for (const [id, node] of Object.entries(day || {})) {
    const mm = /^slot(\d{2})(\d{2})$/.exec(id)
    if (!mm) continue
    const min = Number(mm[1]) * 60 + Number(mm[2])
    if (min < startMin || min >= endMin) continue
    if (skipRange && min >= skipRange.start && min < skipRange.end) continue
    if (!slotExists(node)) continue
    if (node.phantom) {
      upd[`${prefix}${id}`] = null
      continue
    }
    upd[`${prefix}${id}/available`] = true
    upd[`${prefix}${id}/time`] = slotTimeAt(min)
    upd[`${prefix}${id}/phantom`] = null
    upd[`${prefix}${id}/bookingStart`] = null
    if (extra) for (const [k, v] of Object.entries(extra)) upd[`${prefix}${id}/${k}`] = v
  }
  return upd
}

// Множина slotId, які займає діапазон.
export function rangeSlotIds(startMin, durMin, step = 30) {
  const ids = new Set()
  for (let i = 0; i < durMin; i += step) ids.add(slotIdAt(startMin + i))
  return ids
}
