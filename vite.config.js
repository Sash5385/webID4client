import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Single source of truth for the app version (src/version.js)
function readVersion() {
  try {
    const src = readFileSync(resolve(__dirname, 'src/version.js'), 'utf8')
    const m = src.match(/"([^"]+)"/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

// Emits /version.json (matching src/version.js) and injects an inline guard
// into index.html. The guard runs BEFORE the app bundle, so even a browser
// whose service worker is serving a stale index.html can detect a new deploy,
// tear down the SW + caches, and reload onto fresh code. Checks the version
// immediately, then periodically (every 45s) and on tab-visible, so an
// already-open session also picks up a new deploy without a manual reload.
function versionGuard() {
  let version = ''
  let overlayJs = ''
  return {
    name: 'id4drive-client-version-guard',
    buildStart() {
      version = readVersion()
      // Анімація оновлення — окремий читабельний файл, вставляється в HTML інлайном.
      try { overlayJs = readFileSync(resolve(__dirname, 'src/updateOverlay.inline.js'), 'utf8') } catch { overlayJs = '' }
    },
    transformIndexHtml(html) {
      const guard =
        '<script>(function(){var B=' + JSON.stringify(version) + ';' +
        'function check(){try{fetch("/version.json?_="+Date.now(),{cache:"no-store"})' +
        '.then(function(r){return r.json()}).then(function(d){' +
        'if(d&&d.version&&d.version!==B){' +
        'var k="vreset_"+d.version;if(sessionStorage.getItem(k))return;' +
        'sessionStorage.setItem(k,"1");' +
        // Повноекранна анімація оновлення (src/updateOverlay.inline.js): крутиться паралельно зі
        // справжнім скиданням SW/кешів, а перезавантаження — після її кінця (anim).
        'var ov=window.__updOverlay;var anim=ov?ov.show(d.version):Promise.resolve();' +
        'function rl(){location.reload()}' +
        // Якщо unregister/caches.delete зависне — все одно завершуємо оновлення через 2.5с.
        'var done_=false;function done(){if(done_)return;done_=true;anim.then(rl,rl)}' +
        'setTimeout(done,2500);' +
        'if("serviceWorker"in navigator){' +
        'navigator.serviceWorker.getRegistrations().then(function(rs){' +
        'return Promise.all(rs.map(function(r){return r.unregister()}))})' +
        '.then(function(){return window.caches?caches.keys().then(function(ks){' +
        'return Promise.all(ks.map(function(x){return caches.delete(x)}))}):null})' +
        '.then(done).catch(done)}else{done()}' +
        '}else if("serviceWorker"in navigator){' +
        // Версія збігається, але SW міг зачерствіти на старій сесії (PWA роками
        // не закривалась) — активно проганяємо перевірку оновлення SW-файлу,
        // а не чекаємо пасивного таймера браузера (до 24г).
        'navigator.serviceWorker.getRegistration().then(function(r){r&&r.update()}).catch(function(){})' +
        '}}).catch(function(){})}catch(e){}}' +
        'check();setInterval(check,45000);' +
        'document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")check()});' +
        // Якщо новий SW перехопив контроль (skipWaiting+clientsClaim) — перезавантажуємо,
        // щоб одразу побачити свіжий контент замість застряглого старого бандла.
        // Анімацію показуємо лише коли сторінку вже контролював SW (справжнє оновлення), а не при
        // першій установці SW — там, як і раніше, просто перезавантаження.
        'if("serviceWorker"in navigator){var hadCtl=!!navigator.serviceWorker.controller;' +
        'navigator.serviceWorker.addEventListener("controllerchange",function(){var o=window.__updOverlay;' +
        'function rl(){location.reload()}if(hadCtl&&o){o.show().then(rl,rl)}else{rl()}})}' +
        '})();</script>'
      // Функція-замінник, а не рядок: у коді анімації може бути "$", який replace трактує спеціально.
      return html.replace('</head>', () => (overlayJs ? '<script>' + overlayJs + '</script>' : '') + guard + '</head>')
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version })
      })
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    versionGuard(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-512-maskable.png'],
      manifest: {
        name: 'ID4Drive — Школа водіння',
        short_name: 'ID4Drive',
        description: 'Онлайн-запис на уроки водіння',
        theme_color: '#ff5a3c',
        background_color: '#1c1d21',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'uk',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          // Окрема іконка з відступом (safe zone) для purpose:maskable — логотип
          // без полів "виступав" за межі після обрізки під Android adaptive icon
          // (кругла/квадратна маска обрізає до ~66-80% центру, а суцільний
          // "монетний" дизайн торкався країв і його зрізало на APK-збірці).
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Без цього новий SW чекає, поки ВСІ вкладки/сесії PWA закриються, перш
        // ніж активуватись — а PWA на телефоні може роками не закриватись
        // повністю (лише згортатись). skipWaiting+clientsClaim: новий SW бере
        // контроль одразу, щойно браузер його завантажив.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^\/manifest\.json/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'manifest-cache',
              expiration: { maxEntries: 1, maxAgeSeconds: 0 }
            }
          },
          {
            urlPattern: /\.(css)$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'css-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 3600 }
            }
          },
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-storage',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    host: true
  }
})
