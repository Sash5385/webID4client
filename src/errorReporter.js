// Моніторинг помилок: необроблені помилки браузера йдуть на /api/report-error
// (functions: reportError → system/errorLog, розділ "Помилки" в Налаштуваннях адмінки).
import { APP_VERSION } from "./version.js";

const APP_NAME = "client";
const MAX_PER_SESSION = 8;
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /AbortError/,
  /Failed to fetch|Load failed|NetworkError|network error/i, // немає мережі — не баг застосунку
  /chrome-extension:|moz-extension:|safari-extension:/,
  /Failed to (update|register) a ServiceWorker/i,
  /^Rejected$/,
  /newestWorker is null/i,
  /messaging\/unsupported-browser/i,
  // Стара версія після деплою не знайшла файл застосунку — сторінка сама перезавантажується
  /not a valid JavaScript MIME type|dynamically imported module|Importing a module script failed/i,
  /Cannot read properties of undefined \(reading 'default'\)/,
];

const seen = new Set();
let sent = 0;

export function reportError(error, extra = "") {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const message = String((error && error.message) || error || "").slice(0, 300);
    const stack = String((error && error.stack) || extra || "").slice(0, 1500);
    if (!message || IGNORE.some((re) => re.test(message) || re.test(stack))) return;
    const key = message + stack.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ app: APP_NAME, message, stack, url: location.pathname, version: APP_VERSION, ua: navigator.userAgent }),
    }).catch(() => {});
  } catch { /* звіт про помилку сам не має ламати застосунок */ }
}

export function initErrorReporter() {
  if (typeof window === "undefined") return;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;
  window.addEventListener("error", (e) => reportError(e.error || e.message, e.filename ? `${e.filename}:${e.lineno}` : ""));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}
