import { useState, useEffect } from 'react'
import './TestTab.css'

const SEC = 30
const COL = { you: "#f6b21b", red: "#e5544b", blue: "#4d9bf0", green: "#3fbf6f", tram: "#c23b32" }

const THEMES = {
  all:        { label: "Всі теми",       icon: "🎲" },
  right:      { label: "Помеха справа",  icon: "↔️" },
  signs:      { label: "Знаки пріоритету", icon: "⚠️" },
  lights:     { label: "Світлофор",      icon: "🚦" },
  controller: { label: "Регулювальник",  icon: "👮" },
  roundabout: { label: "Кільце",         icon: "⭕" },
  tram:       { label: "Трамвай",        icon: "🚊" },
}
const LEVEL_LABEL = { all: "Всі", 1: "Легко", 2: "Норм", 3: "Складно" }
const LETTERS = ["А", "Б", "В", "Г"]

const S = [
  { theme:"right", level:1, kind:"flat", clause:"п. 16.12",
    cars:[{from:"S",dir:"straight",you:true},{from:"E",dir:"straight",color:COL.red}],
    q:"Нерегульоване рівнозначне перехрестя. Кого пропустити?",
    options:["Червоний — він праворуч","Нікого, у вас перевага","Зачекати всіх"],
    correct:0, why:"Дороги рівнозначні, знаків і світлофора немає → правило правої руки: даєте дорогу тому, хто наближається <b>праворуч</b>." },
  { theme:"right", level:1, kind:"flat", clause:"п. 16.12",
    cars:[{from:"S",dir:"straight",you:true},{from:"W",dir:"straight",color:COL.blue}],
    q:"Рівнозначне перехрестя. Хто проїде першим?",
    options:["Ви","Синій","Одночасно"],
    correct:0, why:"Синій — <b>ліворуч</b>. Перешкода зліва не завадає: поступаються лише тим, хто справа. Перевага у вас." },
  { theme:"right", level:3, kind:"flat", clause:"п. 16.12",
    cars:[{from:"S",dir:"straight",you:true},{from:"E",dir:"straight",color:COL.red},{from:"W",dir:"straight",color:COL.blue}],
    q:"Троє авто прямо на рівнозначному. У якому порядку?",
    options:["Червоний → ви → синій","Ви → червоний → синій","Синій → ви → червоний"],
    correct:0, why:"Ви пропускаєте червоного (він справа). Синій пропускає вас (ви справа від нього). Тому: <b>червоний → ви → синій</b>." },
  { theme:"signs", level:1, kind:"flat", main:"EW", clause:"п. 16.11",
    signs:{S:"giveway",W:"priority",E:"priority"},
    cars:[{from:"S",dir:"straight",you:true},{from:"W",dir:"straight",color:COL.red}],
    q:"Знак 2.1 «Дати дорогу». Ваші дії?",
    options:["Без зупинки пропустити транспорт на головній","Обов'язково зупинитись біля знака","Маєте перевагу"],
    correct:0, why:"Зупинка не потрібна — лише поступитись. На другорядній даєте дорогу всім на <b>головній</b>, незалежно від їх напрямку." },
  { theme:"signs", level:1, kind:"flat", main:"EW", clause:"п. 16.11",
    signs:{W:"priority",E:"priority",S:"giveway"},
    cars:[{from:"W",dir:"straight",you:true},{from:"S",dir:"straight",color:COL.red}],
    q:"Ви на головній дорозі. Хто має перевагу?",
    options:["Ви","Червоний (він праворуч)","Хто перший в'їхав"],
    correct:0, why:"На головній — першочерговий проїзд. Червоний на другорядній і зобов'язаний вас пропустити, навіть якщо він справа." },
  { theme:"signs", level:2, kind:"flat", main:"EW", clause:"знак 2.2",
    signs:{S:"stop",W:"priority",E:"priority"},
    cars:[{from:"S",dir:"straight",you:true},{from:"E",dir:"straight",color:COL.red}],
    q:"Знак 2.2 «STOP». Чим відрізняється від 2.1?",
    options:["Зупинка біля стоп-лінії обов'язкова завжди","Нічим","Можна без зупинки, якщо нікого немає"],
    correct:0, why:"2.2 = повна <b>зупинка</b> перед стоп-лінією (або знаком) незалежно від інших. Далі — пропустити головну." },
  { theme:"signs", level:2, kind:"flat", clause:"п. 16.14",
    mainRibbon:[[0,200],[200,200],[200,0]],
    signs:{S:"giveway",E:"giveway",W:"priority",N:"priority"},
    capt:"Головна дорога змінює напрямок (жовтим). Ви — на другорядній.",
    cars:[{from:"S",dir:"straight",you:true},{from:"N",dir:"right",color:COL.red}],
    q:"Головна повертає. Кому дати дорогу?",
    options:["Червоному — він на головній","Нікому","Тільки трамваям"],
    correct:0, why:"Ви на <b>другорядній</b> → даєте дорогу всім на головній у будь-якому напрямку. Між собою авто на головній діють за правилом правої руки." },
  { theme:"signs", level:3, kind:"flat", roads:["N","E","W"], main:"EW", clause:"п. 16.11",
    signs:{N:"giveway",W:"priority",E:"priority"},
    capt:"Т-подібне перехрестя. Головна — наскрізна (горизонтальна).",
    cars:[{from:"N",dir:"left",you:true},{from:"E",dir:"straight",color:COL.red}],
    q:"Ви виїжджаєте з другорядної (зверху), повертаєте ліворуч. Кого пропустити?",
    options:["Червоного на головній","Нікого","Пішоходів справа"],
    correct:0, why:"Виїзд з другорядної на Т-подібному: пропускаєте весь транспорт на головній. Червоний іде головною — перевага у нього." },
  { theme:"lights", level:1, kind:"flat", lights:"green", clause:"розд. 8",
    cars:[{from:"S",dir:"straight",you:true}],
    q:"Зелений сигнал, попереду вільно. Ваші дії?",
    options:["Проїхати","Зупинитись","Поступитись правому"],
    correct:0, why:"Зелений дозволяє рух. Знаки пріоритету на регульованому перехресті не діють — світлофор головніший." },
  { theme:"lights", level:2, kind:"flat", lights:"green", clause:"п. 16.6",
    cars:[{from:"S",dir:"left",you:true},{from:"N",dir:"straight",color:COL.blue}],
    q:"Зелений. Ви повертаєте ліворуч. Кого пропустити?",
    options:["Зустрічний прямо (і трамвай попутно)","Нікого","Пішоходів позаду"],
    correct:0, why:"Повертаючи ліворуч на зелений, даєте дорогу <b>зустрічним</b> прямо/праворуч та трамваю попутного напрямку." },
  { theme:"lights", level:2, kind:"flat", lights:"green", arrow:{on:false,dir:"right"}, clause:"розд. 8",
    capt:"Світлофор з додатковою секцією. Стрілка не світиться.",
    cars:[{from:"S",dir:"right",you:true}],
    q:"Основний зелений, стрілка праворуч не горить. Можна направо?",
    options:["Ні, доки не загориться стрілка","Так, зелений дозволяє","Так, обережно"],
    correct:0, why:"Рух у напрямку додаткової секції дозволено лише коли <b>стрілка</b> горить. Темна секція = поворот заборонено." },
  { theme:"lights", level:2, kind:"flat", lights:"flash", main:"EW", clause:"п. 8.3",
    signs:{S:"giveway",W:"priority",E:"priority"},
    cars:[{from:"S",dir:"straight",you:true},{from:"W",dir:"straight",color:COL.red}],
    q:"Жовтий миготливий. Як визначається черговість?",
    options:["За знаками пріоритету","За світлофором","Перехрестя закрите"],
    correct:0, why:"Жовтий миготливий = перехрестя <b>нерегульоване</b>. Світлофор не діє (виняток у ієрархії), керуйтесь знаками: у вас «Дати дорогу»." },
  { theme:"lights", level:3, kind:"flat", lights:"green", rails:"V", clause:"п. 16.6",
    cars:[{from:"S",dir:"left",you:true},{from:"N",dir:"straight",tram:true,color:COL.tram}],
    q:"Зелений. Ви — ліворуч, назустріч прямо іде трамвай. Хто перший?",
    options:["Трамвай","Ви","Одночасно"],
    correct:0, why:"При повороті ліворуч даєте дорогу зустрічним прямо — а трамвай тут ще й рейковий. Пропускаєте трамвай." },
  { theme:"controller", level:1, kind:"flat", controller:"up", clause:"п. 8.8 (в)",
    capt:"Регулювальник підняв руку вгору.",
    cars:[{from:"S",dir:"straight",you:true}],
    q:"Рука регулювальника піднята вгору. Що це?",
    options:["Стоп усім напрямкам","Дозволено прямо","Можна, прискорившись"],
    correct:0, why:"Піднята рука — «Увага»: рух заборонено всім (як жовтий). Хто на перехресті — звільняє його." },
  { theme:"controller", level:2, kind:"flat", controller:"sideways", clause:"п. 8.8 (а)",
    capt:"Регулювальник звернений до вас грудьми, руки в сторони/опущені.",
    cars:[{from:"S",dir:"straight",you:true}],
    q:"Регулювальник грудьми до вас, руки в сторони. Ваші дії?",
    options:["Стояти — рух заборонено","Прямо","Праворуч"],
    correct:0, why:"З боку грудей чи спини при такому положенні рук рух <b>заборонено</b>. Їхати дозволено лише з боку лівої/правої руки." },
  { theme:"controller", level:2, kind:"flat", controller:"rightForward", clause:"п. 8.8 (б)",
    capt:"Права рука вперед. Ви — з боку грудей регулювальника.",
    cars:[{from:"S",dir:"right",you:true}],
    q:"Права рука вперед, ви з боку грудей. Куди можна?",
    options:["Лише праворуч","У всіх напрямках","Тільки прямо"],
    correct:0, why:"Права рука вперед: з боку грудей дозволено <b>лише праворуч</b>. З лівого боку — будь-куди, зі спини та справа — заборонено." },
  { theme:"roundabout", level:1, kind:"round", clause:"п. 16.12",
    signs:{S:"roundgive"},
    youEnter:{at:180,dir:"straight"}, onRing:[{at:230,color:COL.red}],
    q:"Ви в'їжджаєте на кільце, по колу рухається авто. Хто перший?",
    options:["Авто на колі","Ви","Хто швидший"],
    correct:0, why:"Перевага в русі надається тим, хто <b>вже рухається по колу</b> (знак 4.10). Той, хто в'їжджає, дає їм дорогу." },
  { theme:"roundabout", level:2, kind:"round", clause:"п. 16.12",
    youRing:{at:200}, enter:[{at:90,color:COL.red}],
    q:"Ви рухаєтесь по колу, праворуч авто хоче в'їхати. Хто має перевагу?",
    options:["Ви","Авто, що в'їжджає","Хто перший"],
    correct:0, why:"Ви вже на колі — перевага у вас. Авто, що в'їжджає, зобов'язане вас пропустити (знак 4.10)." },
  { theme:"tram", level:2, kind:"flat", rails:"H", clause:"п. 16.12",
    cars:[{from:"S",dir:"straight",you:true},{from:"W",dir:"straight",tram:true,color:COL.tram}],
    q:"Рівнозначне перехрестя. Зліва прямо іде трамвай. Хто перший?",
    options:["Трамвай","Ви","Одночасно"],
    correct:0, why:"Трамвай ліворуч — здавалося б, не завадає: перешкода зліва не завадає. Але на рівнозначному перехресті <b>трамвай має перевагу</b> над нерейковими незалежно від напрямку." },
  { theme:"tram", level:3, kind:"flat", rails:"V", clause:"п. 16.13",
    cars:[{from:"S",dir:"left",you:true},{from:"N",dir:"straight",tram:true,color:COL.tram}],
    q:"Рівнозначне. Ви — ліворуч, назустріч прямо трамвай. Кого пропустити?",
    options:["Трамвай (зустрічний)","Нікого","Пішоходів"],
    correct:0, why:"Перед поворотом ліворуч даєте дорогу зустрічним, що йдуть прямо. Зустрічний трамвай — теж зустрічний, пропускаєте його." },
]

const ENTRY = { N:[170,140], S:[230,260], W:[140,230], E:[260,170] }
const EXIT  = { N:[230,140], S:[170,260], E:[260,230], W:[140,170] }
const CARPOS = { N:[170,74],  S:[230,326], W:[74,230],  E:[326,170] }
const CARFRONT = { N:[170,116], S:[230,284], W:[116,230], E:[284,170] }
const HEAD = { N:180, S:0, W:90, E:270 }
const MARK = { N:[122,122], S:[278,278], W:[122,278], E:[278,122] }
const DIRV = { N:[0,-1], S:[0,1], E:[1,0], W:[-1,0] }
const TURN = {
  S:{ straight:"N", left:"W", right:"E" },
  N:{ straight:"S", left:"E", right:"W" },
  W:{ straight:"E", left:"N", right:"S" },
  E:{ straight:"W", left:"S", right:"N" },
}
const INWARD = { 180:"N", 0:"S", 90:"W", 270:"E" }

const neg = ([x,y]) => [-x,-y]
const add = ([x,y],[a,b],s=1) => [x+a*s, y+b*s]

function isect(p, u, q, v) {
  const det = u[0]*-v[1] - -v[0]*u[1]
  const t   = ((q[0]-p[0])*-v[1] - -v[0]*(q[1]-p[1])) / det
  return [p[0]+u[0]*t, p[1]+u[1]*t]
}

function maneuverPath(from, dir) {
  const ex = TURN[from][dir], st = CARFRONT[from], Pin = ENTRY[from], Pout = EXIT[ex]
  const tin = neg(DIRV[from]), tout = DIRV[ex], tip = add(Pout, tout, 12)
  let d
  if (dir === "straight") {
    d = `M ${st[0]} ${st[1]} L ${tip[0]} ${tip[1]}`
  } else if (dir === "right") {
    const c = isect(Pin, tin, Pout, neg(tout))
    d = `M ${st[0]} ${st[1]} L ${Pin[0]} ${Pin[1]} Q ${c[0]} ${c[1]} ${Pout[0]} ${Pout[1]} L ${tip[0]} ${tip[1]}`
  } else {
    const C1 = add(Pin, tin, 40), C2 = add(Pout, tout, -40)
    d = `M ${st[0]} ${st[1]} L ${Pin[0]} ${Pin[1]} C ${C1[0]} ${C1[1]} ${C2[0]} ${C2[1]} ${Pout[0]} ${Pout[1]} L ${tip[0]} ${tip[1]}`
  }
  return { d, tip, dir: ex }
}

function arrowHead([x,y], d) {
  const [vx,vy] = DIRV[d], px=-vy, py=vx, s=10, b=6.5
  const ax=x+vx*s, ay=y+vy*s
  return [[ax,ay],[x+px*b,y+py*b],[x-px*b,y-py*b]].map(p=>p.join(",")).join(" ")
}

function octagon(cx, cy, r) {
  const p = []
  for (let i=0; i<8; i++) {
    const a = Math.PI/8 + i*Math.PI/4
    p.push([cx+r*Math.cos(a), cy+r*Math.sin(a)])
  }
  return p.map(q=>q.map(n=>n.toFixed(1)).join(",")).join(" ")
}

function ring(cd, r, cx=200, cy=200) {
  const a = cd*Math.PI/180
  return [cx+r*Math.sin(a), cy-r*Math.cos(a)]
}

function cardOf(dx, dy) {
  return Math.abs(dx)>Math.abs(dy) ? dx>0?"E":"W" : dy>0?"S":"N"
}

function shuffle(a) {
  const r = a.slice()
  for (let i=r.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [r[i],r[j]] = [r[j],r[i]]
  }
  return r
}

function grade(p) {
  if (p >= 0.9) return { t:"Відмінно — рівень інспектора 🚦", c:"var(--q-green)", bg:"rgba(63,191,111,.15)" }
  if (p >= 0.7) return { t:"Добре, але є над чим попрацювати", c:"var(--q-yellow2)", bg:"rgba(246,178,27,.15)" }
  return { t:"Варто повторити розділ 16 ПДР", c:"var(--q-red)", bg:"rgba(229,84,75,.15)" }
}

// ── SVG components ──────────────────────────────────────────────

function Defs() {
  return (
    <defs>
      <linearGradient id="bodyShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0"    stopColor="#fff" stopOpacity="0.40"/>
        <stop offset="0.42" stopColor="#fff" stopOpacity="0.05"/>
        <stop offset="0.56" stopColor="#000" stopOpacity="0.05"/>
        <stop offset="1"    stopColor="#000" stopOpacity="0.36"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0" stopColor="#3a4c60"/>
        <stop offset="1" stopColor="#8aabc2"/>
      </linearGradient>
      <linearGradient id="aspV" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0"   stopColor="#23262d"/>
        <stop offset="0.5" stopColor="#30343d"/>
        <stop offset="1"   stopColor="#23262d"/>
      </linearGradient>
      <linearGradient id="aspH" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0"   stopColor="#23262d"/>
        <stop offset="0.5" stopColor="#30343d"/>
        <stop offset="1"   stopColor="#23262d"/>
      </linearGradient>
      <radialGradient id="island" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stopColor="#3b6b46"/>
        <stop offset="1" stopColor="#274d31"/>
      </radialGradient>
      <filter id="blurS" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="2.2"/>
      </filter>
    </defs>
  )
}

function TramBody({ x, y, rot }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-14" y="-40" width="28" height="80" rx="9" fill="#000" opacity="0.30" filter="url(#blurS)" transform="translate(1.5 2.5)"/>
      <rect x="-13" y="-40" width="26" height="80" rx="8" fill={COL.tram}/>
      <rect x="-13" y="-40" width="26" height="80" rx="8" fill="url(#bodyShade)"/>
      <path d="M-8,-32 L8,-32 L7,-22 L-7,-22 Z" fill="url(#glass)"/>
      <rect x="-9" y="-18" width="18" height="48" rx="3" fill="#e7ddca" opacity="0.18"/>
      <g fill="#1b1d22" opacity="0.5">
        <rect x="-9" y="-15" width="18" height="2.5"/>
        <rect x="-9" y="-2"  width="18" height="2.5"/>
        <rect x="-9" y="11"  width="18" height="2.5"/>
      </g>
      <rect x="-2" y="-44" width="4" height="5" rx="1" fill="#3a3f4a"/>
      <line x1="0" y1="-38" x2="0" y2="38" stroke="#fff" strokeOpacity="0.07" strokeWidth="2"/>
    </g>
  )
}

function CarBody({ x, y, rot, color, tram }) {
  if (tram) return <TramBody x={x} y={y} rot={rot}/>
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x="-14" y="-22" width="28" height="46" rx="9" fill="#000" opacity="0.30" filter="url(#blurS)" transform="translate(1.5 2.5)"/>
      <rect x="-13" y="-23" width="26" height="46" rx="8" fill={color}/>
      <rect x="-13" y="-23" width="26" height="46" rx="8" fill="url(#bodyShade)"/>
      <rect x="-9" y="-7" width="18" height="22" rx="5" fill="#fff" opacity="0.05"/>
      <path d="M-8,-13 L8,-13 L6,-3 L-6,-3 Z" fill="url(#glass)"/>
      <path d="M-6.5,13 L6.5,13 L8,19.5 L-8,19.5 Z" fill="url(#glass)" opacity="0.92"/>
      <g fill="#15171b">
        <rect x="-16.5" y="-16" width="5" height="11" rx="2"/>
        <rect x="11.5"  y="-16" width="5" height="11" rx="2"/>
        <rect x="-16.5" y="5"   width="5" height="11" rx="2"/>
        <rect x="11.5"  y="5"   width="5" height="11" rx="2"/>
      </g>
      <rect x="-10.5" y="-23.5" width="5.5" height="4" rx="2" fill="#fff7d6"/>
      <rect x="5"     y="-23.5" width="5.5" height="4" rx="2" fill="#fff7d6"/>
      <rect x="-10"   y="19.6"  width="5"   height="3.6" rx="1.6" fill="#ff5b52" opacity="0.85"/>
      <rect x="5"     y="19.6"  width="5"   height="3.6" rx="1.6" fill="#ff5b52" opacity="0.85"/>
      <line x1="0" y1="-19" x2="0" y2="19" stroke="#fff" strokeOpacity="0.08" strokeWidth="2"/>
    </g>
  )
}

function Trajectory({ d, tip, dir, color, you }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={you?16:11} strokeLinecap="round" strokeLinejoin="round" opacity=".1"/>
      <path d={d} fill="none" stroke={color} strokeWidth={you?6:4}  strokeLinecap="round" strokeLinejoin="round" strokeDasharray={you?undefined:"8 5"} opacity={you?0.97:0.8}/>
      <polygon points={arrowHead(tip,dir)} fill={color} opacity={you?0.97:0.8}/>
    </g>
  )
}

function Sign({ type, at }) {
  const [x,y] = MARK[at]
  if (type === "giveway") return (
    <polygon points={`${x-17},${y-13} ${x+17},${y-13} ${x},${y+19}`} fill="#fff" stroke="#e5544b" strokeWidth="4" strokeLinejoin="round"/>
  )
  if (type === "priority") return (
    <g transform={`rotate(45 ${x} ${y})`}>
      <rect x={x-15} y={y-15} width="30" height="30" rx="4" fill="#fff"/>
      <rect x={x-11} y={y-11} width="22" height="22" rx="2" fill="#f6b21b"/>
    </g>
  )
  if (type === "stop") return (
    <g>
      <polygon points={octagon(x,y,18)} fill="#d2362f" stroke="#fff" strokeWidth="2.5"/>
      <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="Manrope">STOP</text>
    </g>
  )
  return null
}

function RoundGive({ x, y }) {
  return (
    <g>
      <polygon points={`${x-16},${y-12} ${x+16},${y-12} ${x},${y+18}`} fill="#fff" stroke="#e5544b" strokeWidth="3.5" strokeLinejoin="round"/>
      <g transform={`translate(${x} ${y-1}) scale(0.5)`}>
        <circle r="15" fill="#1e63c8"/>
        {[0,120,240].map(a => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0,-9 A9,9 0 0,1 7.8,4.5" fill="none" stroke="#fff" strokeWidth="2.4"/>
            <polygon points="9.5,2 6,7 4,1" fill="#fff"/>
          </g>
        ))}
      </g>
    </g>
  )
}

function TrafficLight({ state, at, arrow }) {
  const [x,y] = MARK[at]
  const on = (c) => state==="flash" ? c==="y" : state==="green" ? c==="g" : state==="red" ? c==="r" : c==="y"
  const lit = { r:"#ff5b52", y:"#ffce3a", g:"#3ad07e" }, off = "#2a2f38"
  return (
    <g className={state==="flash"?"flash":""}>
      <rect x={x-10} y={y-26} width="20" height="52" rx="6" fill="#0d0f14" stroke="#363c47"/>
      <circle cx={x} cy={y-15} r="6" fill={on("r")?lit.r:off}/>
      <circle cx={x} cy={y}    r="6" fill={on("y")?lit.y:off}/>
      <circle cx={x} cy={y+15} r="6" fill={on("g")?lit.g:off}/>
      {arrow && (
        <g>
          <rect x={x+11} y={y+7} width="17" height="17" rx="4" fill="#0d0f14" stroke="#363c47"/>
          <polygon points={`${x+15},${y+11} ${x+24},${y+15.5} ${x+15},${y+20}`} fill={arrow.on?"#3ad07e":off}/>
        </g>
      )}
    </g>
  )
}

function Controller({ pose }) {
  const arm = {
    sideways: (
      <g>
        <line x1="200" y1="197" x2="174" y2="197"/>
        <line x1="200" y1="197" x2="226" y2="197"/>
      </g>
    ),
    up: (
      <g>
        <line x1="200" y1="197" x2="218" y2="168"/>
        <line x1="200" y1="197" x2="184" y2="213"/>
      </g>
    ),
    rightForward: (
      <g>
        <line x1="200" y1="197" x2="226" y2="216"/>
        <line x1="200" y1="197" x2="182" y2="210"/>
      </g>
    ),
  }[pose]
  return (
    <g>
      <circle cx="200" cy="200" r="36" fill="rgba(246,178,27,.08)" stroke="rgba(246,178,27,.3)"/>
      <ellipse cx="201.5" cy="244" rx="14" ry="5" fill="#000" opacity="0.3" filter="url(#blurS)"/>
      <circle cx="200" cy="178" r="9" fill="#e9edf3" stroke="#11131a" strokeWidth="1.5"/>
      <rect x="193" y="186" width="14" height="34" rx="6" fill="#f6b21b" stroke="#11131a" strokeWidth="1.5"/>
      <g stroke="#e9edf3" strokeWidth="5" strokeLinecap="round" fill="none">{arm}</g>
      <line x1="200" y1="220" x2="192" y2="240" stroke="#3a3f4a" strokeWidth="5" strokeLinecap="round"/>
      <line x1="200" y1="220" x2="208" y2="240" stroke="#3a3f4a" strokeWidth="5" strokeLinecap="round"/>
    </g>
  )
}

function Rails({ axis }) {
  if (axis === "V") {
    const x = 170
    return (
      <g stroke="#9aa1ad" strokeWidth="2" opacity="0.8">
        <line x1={x-7} y1="0" x2={x-7} y2="400"/>
        <line x1={x+7} y1="0" x2={x+7} y2="400"/>
        {Array.from({length:18}).map((_,i) => (
          <line key={i} x1={x-9} y1={i*23+6} x2={x+9} y2={i*23+6} strokeWidth="1.5" opacity="0.4"/>
        ))}
      </g>
    )
  }
  const y = 230
  return (
    <g stroke="#9aa1ad" strokeWidth="2" opacity="0.8">
      <line x1="0" y1={y-7} x2="400" y2={y-7}/>
      <line x1="0" y1={y+7} x2="400" y2={y+7}/>
      {Array.from({length:18}).map((_,i) => (
        <line key={i} x1={i*23+6} y1={y-9} x2={i*23+6} y2={y+9} strokeWidth="1.5" opacity="0.4"/>
      ))}
    </g>
  )
}

function Crosswalk({ at }) {
  const stripes = []
  if (at==="N"||at==="S") {
    const y = at==="N"?122:262
    for (let i=0;i<6;i++) stripes.push(<rect key={i} x={146+i*18} y={y} width="10" height="16" fill="#e9edf3" opacity="0.55"/>)
  } else {
    const x = at==="W"?122:262
    for (let i=0;i<6;i++) stripes.push(<rect key={i} x={x} y={146+i*18} width="16" height="10" fill="#e9edf3" opacity="0.55"/>)
  }
  return <g>{stripes}</g>
}

function FlatScene({ sc }) {
  const roads = sc.roads || ["N","S","E","W"]
  const has = d => roads.includes(d)
  const ribbon = sc.mainRibbon || (sc.main==="EW"?[[0,200],[400,200]]:sc.main==="NS"?[[200,0],[200,400]]:null)
  return (
    <svg viewBox="0 0 400 400" role="img" aria-label="Схема перехрестя">
      <Defs/>
      <rect x="0" y="0" width="400" height="400" rx="14" fill="#363b44"/>
      {(has("N")||has("S")) && <rect x="140" y="0"   width="120" height="400" fill="url(#aspV)"/>}
      {(has("E")||has("W")) && <rect x="0"   y="140" width="400" height="120" fill="url(#aspH)"/>}
      <rect x="140" y="140" width="120" height="120" fill="#2d313a"/>
      {ribbon && <path d={ribbon.map((p,i)=>(i?"L":"M")+" "+p[0]+" "+p[1]).join(" ")} fill="none" stroke="#f6b21b" strokeOpacity="0.14" strokeWidth="116" strokeLinecap="butt" strokeLinejoin="round"/>}
      <g stroke="#cfd6e0" strokeWidth="2" opacity="0.5" fill="none">
        {has("N") && <g><line x1="140" y1="0"   x2="140" y2="140"/><line x1="260" y1="0"   x2="260" y2="140"/></g>}
        {has("S") && <g><line x1="140" y1="260" x2="140" y2="400"/><line x1="260" y1="260" x2="260" y2="400"/></g>}
        {has("W") && <g><line x1="0"   y1="140" x2="140" y2="140"/><line x1="0"   y1="260" x2="140" y2="260"/></g>}
        {has("E") && <g><line x1="260" y1="140" x2="400" y2="140"/><line x1="260" y1="260" x2="400" y2="260"/></g>}
      </g>
      {sc.rails && <Rails axis={sc.rails}/>}
      <g stroke="#cdd4df" strokeWidth="3" strokeDasharray="14 12" opacity=".45">
        {has("N") && <line x1="200" y1="6"   x2="200" y2="138"/>}
        {has("S") && <line x1="200" y1="262" x2="200" y2="394"/>}
        {has("W") && <line x1="6"   y1="200" x2="138" y2="200"/>}
        {has("E") && <line x1="262" y1="200" x2="394" y2="200"/>}
      </g>
      {roads.map(r => <Crosswalk key={r} at={r}/>)}
      {sc.signs && Object.entries(sc.signs).map(([at,t]) => has(at) ? <Sign key={at} type={t} at={at}/> : null)}
      {sc.lights && has("S") && <TrafficLight state={sc.lights} at="S" arrow={sc.arrow}/>}
      {sc.lights && has("N") && <TrafficLight state={sc.lights} at="N"/>}
      {sc.cars.map((c,i) => {
        const p = maneuverPath(c.from, c.dir)
        return <Trajectory key={"t"+i} d={p.d} tip={p.tip} dir={p.dir} color={c.you?COL.you:c.color||COL.red} you={c.you}/>
      })}
      {sc.cars.map((c,i) => {
        const [cx,cy] = CARPOS[c.from]
        return <CarBody key={"c"+i} x={cx} y={cy} rot={HEAD[c.from]} color={c.you?COL.you:c.color||COL.red} tram={c.tram}/>
      })}
      {sc.cars.map((c,i) => {
        if (!c.you) return null
        const [cx,cy] = CARPOS[c.from]
        return (
          <g key={"b"+i} transform={`translate(${cx-13} ${cy+(c.tram?42:24)})`}>
            <rect width="26" height="15" rx="4" fill="#f6b21b"/>
            <text x="13" y="11" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#1a1206" fontFamily="Manrope">Ви</text>
          </g>
        )
      })}
      {sc.controller && <Controller pose={sc.controller}/>}
    </svg>
  )
}

function RoundScene({ sc }) {
  const Rc=78, Ro=106, Ri=50
  const a0=ring(300,Rc), a1=ring(250,Rc), tipv=ring(245,Rc)
  let youBody=null, youArrow=null, youBadgePos=null

  if (sc.youEnter) {
    const cd=sc.youEnter.at
    const armPos=ring(cd,160), into=ring(cd,Ro-2)
    youBadgePos=armPos
    youBody  = <CarBody x={armPos[0]} y={armPos[1]} rot={(cd+180)%360} color={COL.you}/>
    youArrow = <Trajectory d={`M ${armPos[0]} ${armPos[1]} L ${into[0]} ${into[1]}`} tip={into} dir={INWARD[cd]} color={COL.you} you={true}/>
  }
  if (sc.youRing) {
    const cd=sc.youRing.at, pos=ring(cd,Rc), nx=ring(cd-34,Rc)
    youBadgePos=pos
    const vx=nx[0]-pos[0], vy=nx[1]-pos[1]
    const rot=Math.atan2(vx,-vy)*180/Math.PI
    youBody  = <CarBody x={pos[0]} y={pos[1]} rot={rot} color={COL.you}/>
    youArrow = (
      <g>
        <path d={`M ${pos[0]} ${pos[1]} A ${Rc} ${Rc} 0 0 0 ${nx[0]} ${nx[1]}`} fill="none" stroke={COL.you} strokeWidth="6" strokeLinecap="round" opacity=".95"/>
        <polygon points={arrowHead(nx,cardOf(vx,vy))} fill={COL.you} opacity=".95"/>
      </g>
    )
  }

  const others = []
  ;(sc.onRing||[]).forEach((o,i) => {
    const pos=ring(o.at,Rc), nx=ring(o.at-34,Rc)
    const vx=nx[0]-pos[0], vy=nx[1]-pos[1]
    const rot=Math.atan2(vx,-vy)*180/Math.PI
    others.push(
      <g key={i}>
        <path d={`M ${pos[0]} ${pos[1]} A ${Rc} ${Rc} 0 0 0 ${nx[0]} ${nx[1]}`} fill="none" stroke={o.color} strokeWidth="4" strokeLinecap="round" strokeDasharray="8 5" opacity=".8"/>
        <polygon points={arrowHead(nx,cardOf(vx,vy))} fill={o.color} opacity=".85"/>
        <CarBody x={pos[0]} y={pos[1]} rot={rot} color={o.color}/>
      </g>
    )
  })
  ;(sc.enter||[]).forEach((o,i) => {
    const cd=o.at, armPos=ring(cd,160), into=ring(cd,Ro-2)
    others.push(
      <g key={"e"+i}>
        <Trajectory d={`M ${armPos[0]} ${armPos[1]} L ${into[0]} ${into[1]}`} tip={into} dir={INWARD[cd]} color={o.color}/>
        <CarBody x={armPos[0]} y={armPos[1]} rot={(cd+180)%360} color={o.color}/>
      </g>
    )
  })

  return (
    <svg viewBox="0 0 400 400" role="img" aria-label="Кільце">
      <Defs/>
      <rect x="0" y="0" width="400" height="400" rx="14" fill="#363b44"/>
      {["N","E","S","W"].map(d => {
        const w=56
        if (d==="N") return <rect key={d} x="172" y="0"         width={w} height={200-Ro+8} fill="url(#aspV)"/>
        if (d==="S") return <rect key={d} x="172" y={200+Ro-8}  width={w} height={200-Ro+8} fill="url(#aspV)"/>
        if (d==="W") return <rect key={d} x="0"   y="172"       width={200-Ro+8} height={w} fill="url(#aspH)"/>
        return               <rect key={d} x={200+Ro-8} y="172" width={200-Ro+8} height={w} fill="url(#aspH)"/>
      })}
      <circle cx="200" cy="200" r={Rc} fill="none" stroke="#2f333c" strokeWidth={Ro-Ri}/>
      <circle cx="200" cy="200" r={Rc} fill="none" stroke="#cdd4df" strokeWidth="2.5" strokeDasharray="12 12" opacity=".4"/>
      <circle cx="200" cy="200" r={Ri} fill="url(#island)" stroke="#cfd6e0" strokeWidth="2.5"/>
      <path d={`M ${a0[0]} ${a0[1]} A ${Rc} ${Rc} 0 0 0 ${a1[0]} ${a1[1]}`} fill="none" stroke="#f6b21b" strokeWidth="3" opacity=".55"/>
      <polygon points={`${tipv[0]},${tipv[1]} ${a1[0]+6},${a1[1]-7} ${a1[0]-7},${a1[1]-6}`} fill="#f6b21b" opacity=".55"/>
      {sc.signs?.S==="roundgive" && <RoundGive x={210} y={300}/>}
      {others}
      {youArrow}
      {youBody}
      {youBadgePos && (
        <g transform={`translate(${youBadgePos[0]-13} ${youBadgePos[1]+22})`}>
          <rect width="26" height="15" rx="4" fill="#f6b21b"/>
          <text x="13" y="11" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#1a1206" fontFamily="Manrope">Ви</text>
        </g>
      )}
    </svg>
  )
}

function Scene({ sc }) {
  return sc.kind==="round" ? <RoundScene sc={sc}/> : <FlatScene sc={sc}/>
}

// ── UI components ────────────────────────────────────────────────

function Start({ onStart }) {
  const [theme, setTheme] = useState("all")
  const [level, setLevel] = useState("all")
  const [timed, setTimed] = useState(false)
  const [best] = useState(() => { try { return JSON.parse(localStorage.getItem('id4quiz_best') || 'null') } catch { return null } })
  const count = S.filter(s => (theme==="all"||s.theme===theme) && (level==="all"||s.level===level)).length
  return (
    <div className="card">
      <div className="road-stripe"/>
      <div className="pad">
        <div className="title" style={{fontSize:22}}>
          Проїзд перехресть
          <small style={{fontSize:13}}>Хто проїде першим — за ПДР України</small>
        </div>
        {best && (
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',marginBottom:10,background:'rgba(246,178,27,0.08)',border:'1px solid rgba(246,178,27,0.22)',borderRadius:12}}>
            <span style={{fontSize:20,lineHeight:1}}>🏆</span>
            <div>
              <div style={{fontSize:10,color:'var(--q-yellow2)',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,marginBottom:2}}>Найкращий результат</div>
              <div style={{fontSize:14,fontWeight:800,color:'var(--q-text)'}}>{best.score}/{best.total} · {Math.round(best.p * 100)}%</div>
            </div>
          </div>
        )}
        <div className="lbl2">Тема</div>
        <div className="grid">
          {Object.entries(THEMES).map(([k,v]) => (
            <button key={k} className={"chip"+(theme===k?" on":"")} onClick={()=>setTheme(k)}>
              <span className="ce">{v.icon}</span>{v.label}
            </button>
          ))}
        </div>
        <div className="lbl2">Складність</div>
        <div className="seg">
          {Object.keys(LEVEL_LABEL).map(k => (
            <button key={k} className={"sgb"+(String(level)===k?" on":"")} onClick={()=>setLevel(k==="all"?"all":Number(k))}>
              {LEVEL_LABEL[k]}
            </button>
          ))}
        </div>
        <button className={"toggle"+(timed?" on":"")} onClick={()=>setTimed(t=>!t)}>
          <span>⏱️ Таймер · {SEC} с на питання</span>
          <span className="sw"><i/></span>
        </button>
        <button className="btn primary" disabled={count===0} onClick={()=>onStart({theme,level,timed})}>
          Почати · {count} {count===1?"питання":"питань"}
        </button>
      </div>
    </div>
  )
}

function Quiz({ cfg, onExit }) {
  const [deck] = useState(() => {
    let d = S.filter(s => (cfg.theme==="all"||s.theme===cfg.theme) && (cfg.level==="all"||s.level===cfg.level))
    if (!d.length) d = S.filter(s => cfg.theme==="all"||s.theme===cfg.theme)
    return shuffle(d)
  })
  const [i, setI]       = useState(0)
  const [sel, setSel]   = useState(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const [timeLeft, setTimeLeft] = useState(SEC)
  const total = deck.length
  const sc = deck[i]

  useEffect(() => {
    if (!done) return
    try {
      const p = total ? score / total : 0
      const prev = JSON.parse(localStorage.getItem('id4quiz_best') || '{"p":0}')
      if (p > (prev.p || 0)) localStorage.setItem('id4quiz_best', JSON.stringify({ score, total, p, ts: Date.now() }))
    } catch {}
  }, [done])

  useEffect(() => {
    if (!cfg.timed || sel !== null) return
    if (timeLeft <= 0) { setSel(-1); return }
    const id = setTimeout(() => setTimeLeft(t => t-1), 1000)
    return () => clearTimeout(id)
  }, [cfg.timed, sel, timeLeft, i])

  const pick = k => {
    if (sel !== null) return
    setSel(k)
    if (k === sc.correct) setScore(s => s+1)
  }
  const next = () => {
    if (i+1 >= total) { setDone(true) }
    else { setI(i+1); setSel(null); setTimeLeft(SEC) }
  }

  if (done) {
    const p = total ? score/total : 0, g = grade(p)
    return (
      <div className="card">
        <div className="road-stripe"/>
        <div className="pad">
          <div className="result">
            <div className="lbl">Ваш результат</div>
            <div className="big" style={{color:g.c}}>
              {score}<span style={{fontSize:22,color:"var(--q-muted)"}}>/{total}</span>
            </div>
            <div className="grade" style={{color:g.c,background:g.bg}}>{g.t}</div>
          </div>
          <button className="btn primary" onClick={onExit}>До налаштувань</button>
        </div>
      </div>
    )
  }

  const tFrac = timeLeft/SEC
  const tColor = timeLeft<=10?"var(--q-red)":timeLeft<=20?"var(--q-yellow)":"var(--q-green)"

  return (
    <div className="card">
      <div className="road-stripe"/>
      <div className="pad">
        <div className="head">
          <div className="title">
            Проїзд перехресть
            <small>{THEMES[sc.theme].label} · {LEVEL_LABEL[sc.level]}</small>
          </div>
          <div className="score">{score} балів</div>
        </div>
        <div className="progress"><i style={{width:`${i/total*100}%`}}/></div>
        {cfg.timed && sel===null && <div className="timer"><i style={{width:`${tFrac*100}%`,background:tColor}}/></div>}
        <div className="step">
          <span>Питання {i+1} з {total}</span>
          <span className="clause">{sc.clause}</span>
        </div>
        <div className="stage"><Scene sc={sc}/></div>
        {sc.capt && <div className="caption">{sc.capt}</div>}
        <div className="q">{sc.q}</div>
        <div className="opts">
          {sc.options.map((o,k) => {
            let cls = "opt"
            if (sel !== null) {
              if (k===sc.correct) cls += " "+(k===sel?"correct":"reveal")
              else if (k===sel) cls += " wrong"
            }
            return (
              <button key={k} className={cls} disabled={sel!==null} onClick={()=>pick(k)}>
                <span className="dot">{LETTERS[k]}</span>{o}
              </button>
            )
          })}
        </div>
        {sel!==null && (
          <div className="explain">
            {sel===-1 && <div className="timeup">⏱️ Час вийшов</div>}
            <span dangerouslySetInnerHTML={{__html:sc.why}}/>
          </div>
        )}
        {sel!==null && (
          <button className="btn primary" onClick={next}>
            {i+1>=total?"Завершити":"Далі →"}
          </button>
        )}
        <div className="legend">
          <span><i style={{background:COL.you}}/> ви</span>
          <span><i style={{background:"#fff",border:"2px solid #e5544b"}}/> дати дорогу</span>
          <span><i style={{background:"#f6b21b"}}/> головна</span>
          <span><i style={{background:COL.tram}}/> трамвай</span>
        </div>
      </div>
    </div>
  )
}

export default function TestTab() {
  const [cfg, setCfg] = useState(null)
  return (
    <div className="quiz-wrap">
      <div className="q-root">
        {!cfg
          ? <Start onStart={setCfg}/>
          : <Quiz cfg={cfg} onExit={()=>setCfg(null)}/>
        }
      </div>
    </div>
  )
}
