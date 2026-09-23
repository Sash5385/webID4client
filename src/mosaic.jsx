import { useEffect, useRef, useState } from "react";

// Дрібна мозаїчна плитка, яка "накриває" старий екран і "розкриває" новий
// при перемиканні (той самий прийом, що на публічних лендингах: сітка
// квадратів кольору фону, які ховаються по діагональній хвилі). Спершу
// плитки миттєво з'являються й ховають старий вміст, тоді вміст підміняється
// під ними, і плитки одна за одною (по діагоналі) зникають, розкриваючи нове.
const MOSAIC_COLS = 8;
const MOSAIC_ROWS = 6;
const MOSAIC_TILES = Array.from({ length: MOSAIC_COLS * MOSAIC_ROWS }, (_, i) => ({
  key: i,
  delay: (Math.floor(i / MOSAIC_COLS) + (i % MOSAIC_COLS)) * 16,
}));
const COVER_MS = 150;
const REVEAL_MS = 340;

// speed — множник тривалості (0.5 = удвічі швидше за стандартну settings-анімацію).
export function useMosaicSwitch(key, speed = 1) {
  const [displayed, setDisplayed] = useState(key);
  const [phase, setPhase] = useState("idle"); // idle | cover | reveal
  const prevKey = useRef(key);
  useEffect(() => {
    if (key === prevKey.current) return;
    prevKey.current = key;
    setPhase("cover");
    const t1 = setTimeout(() => {
      setDisplayed(key);
      setPhase("reveal");
      const t2 = setTimeout(() => setPhase("idle"), REVEAL_MS * speed + 40);
      return () => clearTimeout(t2);
    }, COVER_MS * speed);
    return () => clearTimeout(t1);
  }, [key, speed]);
  return [displayed, phase];
}

export function MosaicOverlay({ phase, tileColor, zIndex = 30, speed = 1 }) {
  if (phase === "idle") return null;
  const coverS = (0.15 * speed).toFixed(3);
  const revealS = (0.34 * speed).toFixed(3);
  return (
    <div aria-hidden="true" style={{
      position:"absolute", inset:0, display:"grid",
      gridTemplateColumns:`repeat(${MOSAIC_COLS},1fr)`, gridTemplateRows:`repeat(${MOSAIC_ROWS},1fr)`,
      pointerEvents:"none", zIndex,
    }}>
      {MOSAIC_TILES.map(t => (
        <div key={t.key} style={{
          background:tileColor,
          transform: phase === "cover" ? "scale(1)" : "scale(0)",
          opacity: phase === "cover" ? 1 : 0,
          transition: phase === "cover"
            ? `transform ${coverS}s ease, opacity ${coverS}s ease`
            : `transform ${revealS}s ease ${t.delay * speed}ms, opacity ${revealS}s ease ${t.delay * speed}ms`,
        }}/>
      ))}
    </div>
  );
}
