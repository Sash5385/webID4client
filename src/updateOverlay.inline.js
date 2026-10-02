// Повноекранна анімація оновлення застосунку — кільце прогресу (як у проєкті Magentic).
//
// Це ЗВИЧАЙНИЙ скрипт без залежностей і без React: vite.config.js вставляє його в
// index.html інлайном (перед version guard), тому він працює і до завантаження
// застосунку, і навіть зі "застряглим" старим бандлом. У бандл він НЕ імпортується.
//
// API (window.__updOverlay):
//   show(version?) → Promise, що завершується після анімації (показано "Готово").
//                    Сторінку НЕ перезавантажує — це робить викликач. Повторний
//                    виклик під час анімації повертає той самий Promise.
//   hide()         — прибрати оверлей.
//   preview()      — показати анімацію й сховати без перезавантаження
//                    (те саме запускає адреса з параметром ?upd-preview).
(function () {
  if (window.__updOverlay) return;

  var ANIM_MS = 2800;    // тривалість руху кільця 0 → 100%
  var DONE_MS = 450;     // скільки тримаємо "Готово", перш ніж віддати керування
  var SAFETY_MS = 15000; // якщо після анімації перезавантаження так і не сталось — прибираємо оверлей
  var R = 54;
  var C = 2 * Math.PI * R;

  var TEXT = {
    uk: { title: 'Оновлення застосунку', done: 'Готово', stages: ['Завантаження…', 'Перевірка…', 'Встановлення…'] },
    en: { title: 'Updating the app', done: 'Done', stages: ['Downloading…', 'Verifying…', 'Installing…'] }
  };

  var CSS =
    '#__upd-ov{position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;display:grid;place-items:center;' +
    'background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);color:#f3eeff;' +
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;touch-action:none;overscroll-behavior:contain;' +
    'animation:__upd-in .25s ease-out}' +
    '#__upd-ov .upd-box{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px;text-align:center}' +
    '#__upd-ov .upd-ring{position:relative;display:grid;place-items:center;width:144px;height:144px}' +
    '#__upd-ov svg{position:absolute;top:0;left:0;width:100%;height:100%;transform:rotate(-90deg)}' +
    '#__upd-ov .upd-pct{font-size:30px;line-height:36px;font-weight:700;font-variant-numeric:tabular-nums}' +
    '#__upd-ov .upd-title{font-size:18px;line-height:28px;font-weight:600}' +
    '#__upd-ov .upd-sub{margin-top:4px;font-size:14px;line-height:20px;color:#ddd2fb;min-height:20px}' +
    '@keyframes __upd-in{from{opacity:0}to{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){#__upd-ov{animation:none}}';

  var current = null; // Promise поточної анімації
  var el = null;

  function lang() {
    try {
      var l = localStorage.getItem('id4lang') || document.documentElement.lang || '';
      return /^en/i.test(l) ? 'en' : 'uk';
    } catch (e) { // eslint-disable-line no-unused-vars -- старі WebView без optional catch binding
      return 'uk';
    }
  }

  function onBody(cb) {
    if (document.body) cb();
    else document.addEventListener('DOMContentLoaded', cb);
  }

  function ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Версія, до якої оновлюємось, якщо викликач її не передав.
  function fetchVersion() {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(''); }, 2000);
      try {
        fetch('/version.json?_=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (d) { clearTimeout(timer); resolve((d && d.version) || ''); })
          .catch(function () { clearTimeout(timer); resolve(''); });
      } catch (e) { // eslint-disable-line no-unused-vars
        clearTimeout(timer);
        resolve('');
      }
    });
  }

  function build() {
    if (!document.getElementById('__upd-css')) {
      var st = document.createElement('style');
      st.id = '__upd-css';
      st.appendChild(document.createTextNode(CSS));
      document.head.appendChild(st);
    }
    var box = document.createElement('div');
    box.id = '__upd-ov';
    box.setAttribute('role', 'alert');
    box.setAttribute('aria-live', 'polite');
    box.innerHTML =
      '<div class="upd-box">' +
        '<div class="upd-ring">' +
          '<svg viewBox="0 0 120 120">' +
            '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="7"/>' +
            '<circle class="upd-arc" cx="60" cy="60" r="' + R + '" fill="none" stroke="url(#__upd-g)" stroke-width="7" ' +
              'stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/>' +
            '<defs><linearGradient id="__upd-g" x1="0" x2="1">' +
              '<stop offset="0" stop-color="#a58aff"/><stop offset="1" stop-color="#5fd3f0"/>' +
            '</linearGradient></defs>' +
          '</svg>' +
          '<span class="upd-pct">0%</span>' +
        '</div>' +
        '<div><div class="upd-title"></div><div class="upd-sub"></div></div>' +
      '</div>';
    return box;
  }

  function hide() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
    current = null;
  }

  function show(version) {
    if (current) return current;
    current = new Promise(function (resolve) {
      onBody(function () {
        var mine = el = build();
        document.body.appendChild(el);
        var t = TEXT[lang()];
        var arc = el.querySelector('.upd-arc');
        var pct = el.querySelector('.upd-pct');
        var title = el.querySelector('.upd-title');
        var sub = el.querySelector('.upd-sub');
        var ver = version || '';
        var finished = false;

        function label() {
          if (!ver) return '';
          return /^v/i.test(ver) ? ver : 'v' + ver;
        }
        function render(p) {
          var done = p >= 100;
          arc.setAttribute('stroke-dashoffset', String(C * (1 - p / 100)));
          pct.textContent = done ? '✓' : p + '%';
          title.textContent = done ? t.done : t.title;
          sub.textContent = done ? label() : t.stages[p < 34 ? 0 : p < 68 ? 1 : 2];
        }

        render(0);
        if (!ver) {
          fetchVersion().then(function (v) {
            ver = v;
            if (finished) render(100);
          });
        }

        var start = Date.now();
        var timer = setInterval(function () {
          var k = Math.min(1, (Date.now() - start) / ANIM_MS);
          var p = Math.round(ease(k) * 100);
          render(p);
          if (k >= 1) {
            clearInterval(timer);
            finished = true;
            setTimeout(resolve, DONE_MS);
            // Страховка: перезавантаження не відбулось — не лишаємо екран заблокованим.
            setTimeout(function () { if (el === mine) hide(); }, DONE_MS + SAFETY_MS);
          }
        }, 40);
      });
    });
    return current;
  }

  function preview() {
    return show().then(hide, hide);
  }

  window.__updOverlay = { show: show, hide: hide, preview: preview };

  // Подивитись анімацію без справжнього оновлення: відкрити застосунок з ?upd-preview
  if (/[?&]upd-preview(=|&|$)/.test(location.search)) {
    onBody(function () { setTimeout(preview, 600); });
  }
})();
