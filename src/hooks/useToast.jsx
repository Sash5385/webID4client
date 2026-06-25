import { useState, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg, type = 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const ToastEl = toast ? (
    <>
      <style>{`@keyframes _toast-in{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <div style={{
        position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, maxWidth: 340, width: 'calc(100% - 32px)',
        background: 'var(--surface)',
        borderRadius: 12, padding: '11px 16px',
        boxShadow: 'var(--shadow)',
        borderLeft: `3px solid ${toast.type === 'error' ? 'var(--accent)' : 'var(--green)'}`,
        color: toast.type === 'error' ? 'var(--accent)' : 'var(--green)',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
        animation: '_toast-in 0.2s ease',
        pointerEvents: 'none',
      }}>{toast.msg}</div>
    </>
  ) : null

  return { showToast, ToastEl }
}
