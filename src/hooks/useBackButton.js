import { useEffect } from 'react'

// Стек відкритих модалок/шторок — апаратна кнопка "назад" на Android
// закриває верхню з них замість переходу по історії або виходу з застосунку.
let stack = []

export function registerBackHandler(onBack) {
  stack.push(onBack)
  return () => {
    stack = stack.filter(fn => fn !== onBack)
  }
}

export function consumeBackHandler() {
  if (stack.length === 0) return false
  const top = stack[stack.length - 1]
  top()
  return true
}

// Реєструє onClose як обробник апаратної кнопки "назад" поки active === true
export function useBackClose(active, onClose) {
  useEffect(() => {
    if (!active) return
    return registerBackHandler(onClose)
  }, [active, onClose])
}
