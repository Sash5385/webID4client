import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { APP_VERSION } from '../version.js'
import { getAdminServices, getUpcomingFreeSlots } from '../firebase/db'
import { parseYMD, getDayName, formatDateYMD } from '../utils/date'
import './Landing.css'

const REVIEWS_URL = 'https://europe-west1-id4drive-booking-44182.cloudfunctions.net/getGoogleReviews'

// Та сама палітра, що й у виборі кольору послуги в адмінці (colorId) —
// бабл ціни на лендингу тонується в колір, обраний для послуги там.
const SERVICE_COLORS = {
  green: '#7ed957', yellow: '#f7c948', blue: '#5b9bff', purple: '#c084fc',
  red: '#ff5a3c', teal: '#2dd4bf', pink: '#f472b6', orange: '#fb923c',
  indigo: '#818cf8', lime: '#a3e635',
}
const colorOfService = (colorId) => SERVICE_COLORS[colorId] || SERVICE_COLORS.green

// Підпис дня для тизера найближчих вільних місць — "Сьогодні"/"Завтра"/скорочена назва дня.
function slotDayLabel(dateStr) {
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  if (dateStr === formatDateYMD(today)) return 'Сьогодні'
  if (dateStr === formatDateYMD(tomorrow)) return 'Завтра'
  return getDayName(parseYMD(dateStr).getDay())
}

const STATIC_REVIEWS = [
  { name: 'Пшик Вероніка', initials: 'ПВ', color: 'linear-gradient(165deg,#c084fc,#7c3aed)', date: '21 січня 2026', text: 'Дякую дуже Олександру за професіоналізм, холодний розум, спокій та супер класне навчання! Навчалась з нуля, здала практику з другого разу. Завдячую вам! ☺️' },
  { name: 'Ірина', initials: 'ІР', color: 'linear-gradient(165deg,#ff7a5c,#ff5a3c)', date: '9 квітня 2026', text: 'Олександр, дуже Вам дякую за кожен урок! За кожне пояснення! За спокійну атмосферу! Доходило не зразу, але завдяки вашим зусиллям — я здала!' },
  { name: 'Ірина Леснік', initials: 'ІЛ', color: 'linear-gradient(165deg,#2dd4bf,#0d9488)', date: '6 лютого 2026', text: 'Олександре, щиро дякую вам за урок водіння! Дуже приємно навчатися з таким спокійним, уважним і підтримуючим інструктором. Завдяки вам з\'являється впевненість за кермом і бажання рухатися далі. Дякую за терпіння, пояснення й позитивну атмосферу — це дуже цінно' },
  { name: 'Ірина', initials: 'ІР', color: 'linear-gradient(165deg,#ff7a5c,#ff5a3c)', date: '9 квітня 2026', text: 'Комфортно. Спокійно. Ви справжній професіонал' },
  { name: 'Марчук Вікторія', initials: 'МВ', color: 'linear-gradient(165deg,#fb923c,#ea580c)', date: '3 лютого 2026', text: 'Чудовий інструктор. Все чітко та зрозуміло пояснює. Дуже ввічливий' },
  { name: 'Лящинська Світлана', initials: 'ЛС', color: 'linear-gradient(165deg,#5b9bff,#2563eb)', date: '10 лютого 2026', text: 'Благодаря Вам, сегодня у меня на 0,001% лучше получилось, и я стала чуть меньше бояться' },
]

const AVATAR_COLORS = [
  'linear-gradient(165deg,#ff7a5c,#ff5a3c)',
  'linear-gradient(165deg,#fb923c,#ea580c)',
  'linear-gradient(165deg,#5b9bff,#2563eb)',
  'linear-gradient(165deg,#c084fc,#7c3aed)',
  'linear-gradient(165deg,#2dd4bf,#0d9488)',
]

function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function starsStr(rating) {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating)
}

// 14 фото автошколи поділені на 3 НЕПЕРЕТИННІ набори — по одному на слот.
// Це гарантує, що те саме фото фізично не може з'явитись у двох картках
// одночасно (набори не перетинаються), а не просто малоймовірно.
const HERO_PHOTO_ORDER_A = [6, 9, 2, 4, 7]
const HERO_PHOTO_ORDER_B = [13, 5, 3, 14, 11]
const HERO_PHOTO_ORDER_C = [8, 1, 10, 12]
const HERO_PHOTO_SECONDS = 3.4 // тривалість показу одного фото в слоті

function PhotoCollageSlot({ order, phase, className }) {
  const duration = order.length * HERO_PHOTO_SECONDS
  // Вікно "показано" має дорівнювати рівно 1/N слоту (гарантована суцільна
  // естафета без пропусків і без напливу одне на одне) — тому клас із
  // ключовими кадрами обирається саме під кількість фото в цьому слоті.
  const animName = `hp-blur-dissolve-${order.length}`
  return (
    <div className={`hp-slot ${className}`}>
      {order.map((num, i) => (
        <div
          key={num}
          className="hp-layer"
          style={{
            backgroundImage: `url(/hero/hero-${String(num).padStart(2, '0')}.jpg)`,
            animationName: animName,
            animationDuration: `${duration}s`,
            animationDelay: `${-(i * HERO_PHOTO_SECONDS) + phase}s`,
          }}
        />
      ))}
    </div>
  )
}

export default function Landing({ user, profile }) {
  useTheme()
  const nav = useNavigate()
  const [reviews, setReviews] = useState([])
  const [termsOpen, setTermsOpen] = useState(false)
  const [services, setServices] = useState([])
  const [upcomingSlots, setUpcomingSlots] = useState([])

  useEffect(() => {
    fetch(REVIEWS_URL)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length) setReviews(data.filter(r => r.author_name !== 'Ольга Войцещук').slice(0, 5)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    getAdminServices().then(setServices).catch(() => {})
  }, [])

  useEffect(() => {
    getUpcomingFreeSlots(6).then(setUpcomingSlots).catch(() => {})
  }, [])

  // Ціна за годину для кожного напрямку — перша активна 1-годинна послуга цього типу.
  const schoolService = services.find(s => s.type === 'school' && Number(s.duration) === 60)
  const privateService = services.find(s => s.type === 'private' && Number(s.duration) === 60)
  const schoolService2h = services.find(s => s.type === 'school' && Number(s.duration) === 120)
  const privateService2h = services.find(s => s.type === 'private' && Number(s.duration) === 120)

  const goAuth = () => nav(user && profile ? '/cabinet' : '/auth')
  const goRegister = () => nav(user && profile ? '/cabinet' : '/auth')
  const goBookSlot = (date, time) => nav(user && profile ? `/cabinet?date=${date}&time=${time}` : '/auth')

  const nearestSlot = upcomingSlots[0]

  // Примусове оновлення — скидає service worker і кеш перед перезавантаженням,
  // щоб гарантовано підтягнути нову версію (тап на лого в топбарі лендингу).
  const forceUpdate = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.() || []
      await Promise.all(regs.map(r => r.unregister()))
      if (window.caches) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
    } finally {
      window.location.reload()
    }
  }

  return (
    <div className="landing-page">

      {/* TOP BAR */}
      <header className="landing-topbar">
        <div className="container landing-topbar-row">
          <a
            href="https://zhaivoronok.com.ua"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-school"
          >
            АВТОШКОЛА
          </a>
          <div className="logo" onClick={forceUpdate} style={{cursor:'pointer'}}>
            <div className="logo-icon"><img src="/icon-192.png" alt="ID4Drive"/></div>
            ID4Drive
          </div>
          <button className="btn-login" onClick={goRegister}>
            {user ? 'Кабінет' : 'Увійти'}
          </button>
        </div>
      </header>

      <div className="container">

        {/* HERO */}
        <section className="hero">
          <div className="hero-media">
            <div className="photo-collage">
              <PhotoCollageSlot order={HERO_PHOTO_ORDER_A} phase={0}  className="hp-slot-a" />
              <PhotoCollageSlot order={HERO_PHOTO_ORDER_B} phase={-4} className="hp-slot-b" />
              <PhotoCollageSlot order={HERO_PHOTO_ORDER_C} phase={-8} className="hp-slot-c" />
            </div>
          </div>
          <div className="hero-body">
            <h1>Уроки водіння</h1>
            <p>Онлайн-запис на уроки водіння в Києві.<br/>Автошкола та приватні уроки.</p>
            <button className="hero-cta" onClick={goAuth}>📅 Записатись на урок</button>

            <div className="hero-stats">
              <div className="stat-card">
                <div className="stat-num">20+</div>
                <div className="stat-lbl">років досвіду</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">2000+</div>
                <div className="stat-lbl">учнів</div>
              </div>
            </div>
          </div>
        </section>

        {/* SERVICES */}
        <section className="lsection">
          <div className="lsection-title">Послуги</div>
          <div className="services">
            <div className="service-card" onClick={goRegister}>
              <div className="service-icon ico-school">🎓</div>
              <div className="service-info">
                <div className="service-title">Автошкола</div>
                <div className="service-desc">Повний курс, 40 годин, документи</div>
              </div>
              <div className="service-arrow">→</div>
            </div>
            <div className="service-card" onClick={goRegister}>
              <div className="service-icon ico-private">🚙</div>
              <div className="service-info">
                <div className="service-title">Приватні уроки</div>
                <div className="service-desc">Індивідуально, гнучкий графік, 1 або 2 години</div>
              </div>
              <div className="service-arrow">→</div>
            </div>
          </div>
        </section>

        {/* PRICING */}
        {(schoolService || privateService) && (
          <section className="lsection">
            <div className="lsection-title">Ціни</div>
            <h2>Скільки коштує урок</h2>
            <div className="pricing-bubbles">
              {schoolService && (
                <div className="pricing-bubble" style={{ '--c': colorOfService(schoolService.colorId) }}>
                  <div className="pricing-bubble-icon">🎓</div>
                  <div className="pricing-bubble-lbl">Автошкола</div>
                  <div className="pricing-bubble-num">{schoolService.price}<span>₴/год</span></div>
                  {schoolService2h && <div className="pricing-bubble-sub">2 год — <b>{schoolService2h.price}₴</b></div>}
                </div>
              )}
              {privateService && (
                <div className="pricing-bubble" style={{ '--c': colorOfService(privateService.colorId) }}>
                  <div className="pricing-bubble-icon">🚙</div>
                  <div className="pricing-bubble-lbl">Приватні</div>
                  <div className="pricing-bubble-num">{privateService.price}<span>₴/год</span></div>
                  {privateService2h && <div className="pricing-bubble-sub">2 год — <b>{privateService2h.price}₴</b></div>}
                </div>
              )}
            </div>
          </section>
        )}

        {/* NEAREST SLOTS */}
        {nearestSlot && (
          <section className="lsection">
            <div className="lsection-title">Розклад</div>
            <h2>Найближчі вільні місця</h2>

            <div className="next-slot-card">
              <div className="next-slot-lbl">Найближче вікно</div>
              <div className="next-slot-big">{slotDayLabel(nearestSlot.date)}, {nearestSlot.time}</div>
              <div className="next-slot-sub">
                {upcomingSlots.length > 1
                  ? `Ще ${upcomingSlots.length - 1} вільних варіантів цього тижня`
                  : 'Встигни записатись, поки є місце'}
              </div>
              <button className="next-slot-cta" onClick={() => goBookSlot(nearestSlot.date, nearestSlot.time)}>📅 Забронювати</button>
            </div>

            {upcomingSlots.length > 1 && (
              <>
                <div className="slot-chips-lbl">Або обери інший час</div>
                <div className="slot-chips">
                  {upcomingSlots.map((s, i) => (
                    <button
                      key={`${s.date}_${s.time}`}
                      className={`slot-chip${i === 0 ? ' active' : ''}`}
                      onClick={() => goBookSlot(s.date, s.time)}
                    >
                      <div className="slot-chip-day">{slotDayLabel(s.date)}</div>
                      <div className="slot-chip-time">{s.time}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* FEATURES */}
        <section className="lsection">
          <div className="lsection-title">Переваги</div>
          <div className="features">
            <div className="feature-card">
              <div className="feature-icon fi-1">📱</div>
              <div className="feature-title">Онлайн-запис</div>
              <div className="feature-desc">Бронюй уроки в зручний час за 1 хв</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon fi-2">🔄</div>
              <div className="feature-title">Гнучкий перенос</div>
              <div className="feature-desc">Переноси урок прямо в додатку</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon fi-3">🔔</div>
              <div className="feature-title">Сповіщення</div>
              <div className="feature-desc">Як тільки слот звільняється — ти дізнаєшся першим</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon fi-4">⏰</div>
              <div className="feature-title">Лист очікування</div>
              <div className="feature-desc">Автозапис на вільне місце</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon fi-5">🚗</div>
              <div className="feature-title">Якісна підготовка</div>
              <div className="feature-desc">Рух дорогами Києва, паркування, розвороти, складні перехрестя</div>
            </div>
            <div className="feature-card">
              <div className="feature-icon fi-6">📋</div>
              <div className="feature-title">Підготовка до іспиту</div>
              <div className="feature-desc">Проїзд маршрутів сервісних центрів, нюанси складання іспиту</div>
            </div>
          </div>
        </section>

        {/* INSTRUCTOR */}
        <section className="lsection">
          <div className="lsection-title">Інструктор</div>
          <h2>Олександр</h2>
          <div className="instructor-card">
            <img src="/instructor.png" className="instructor-avatar" alt="Олександр" />
            <div className="instructor-info">
              <div className="instructor-name">Олександр</div>
              <div className="instructor-role">Інструктор з водіння</div>
              <div className="instructor-meta">
                <span>📍 Київ, Верховинна 44</span>
                <span>🚗 Стаж 20+ років</span>
                <span>✅ Сертифікований</span>
              </div>
            </div>
          </div>
        </section>

        {/* REVIEWS */}
        <section className="lsection">
          <div className="lsection-title">Відгуки</div>
          <h2>Що кажуть учні</h2>
        </section>
        <div className="reviews-scroll">
          {STATIC_REVIEWS.map((r, i) => (
            <div className="review-card" key={`s${i}`}>
              <div className="review-stars">★★★★★</div>
              <div className="review-text">"{r.text}"</div>
              <div className="review-author">
                <div className="review-avatar" style={{background: r.color}}>{r.initials}</div>
                <div><div className="review-name">{r.name}</div><div className="review-date">{r.date}</div></div>
              </div>
            </div>
          ))}
          {reviews.map((r, i) => (
            <div className="review-card" key={`g${i}`}>
              <div className="review-stars" style={{color: r.rating >= 4 ? '#f7c948' : '#ff5a3c'}}>
                {starsStr(r.rating)}
              </div>
              <div className="review-text">"{r.text}"</div>
              <div className="review-author">
                {r.profile_photo_url
                  ? <img src={r.profile_photo_url} className="review-avatar" style={{objectFit:'cover', background:'none'}} alt={r.author_name} />
                  : <div className="review-avatar" style={{background: AVATAR_COLORS[i % AVATAR_COLORS.length]}}>{initials(r.author_name)}</div>
                }
                <div>
                  <div className="review-name">{r.author_name}</div>
                  <div className="review-date">{r.relative_time_description}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CONTACTS */}
        <section className="lsection">
          <div className="lsection-title">Контакти</div>
          <h2>Звʼязатись зі мною</h2>
          <div className="contacts">
            <div className="contact-icon-row">
              <a href="tel:+380989225442" className="contact-icon-btn contact-icon-btn--call" aria-label="Зателефонувати">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.24 1.01l-2.21 2.21z"/></svg>
              </a>
              <a href="https://t.me/id4drive" target="_blank" rel="noreferrer" className="contact-icon-btn contact-icon-btn--tg" aria-label="Telegram">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8c-.12.57-.46.71-.93.44l-2.58-1.9-1.24 1.19c-.14.14-.25.25-.51.25l.18-2.62 4.72-4.26c.2-.18-.05-.28-.32-.1L7.6 14.47l-2.54-.79c-.55-.17-.56-.55.12-.82l9.93-3.83c.46-.17.86.11.53.77z"/></svg>
              </a>
              <a href="viber://chat?number=%2B380989225442" className="contact-icon-btn contact-icon-btn--viber" aria-label="Viber">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 1.5C7.5 1.7 4 4.4 3.2 8.2c-.4 2-.3 3.9.4 5.7.5 1.3 1.4 2.5 2.4 3.5l.3 3.3c.1.6.8.8 1.2.4l2.4-2.1c.6.1 1.2.2 1.8.2 4.3 0 7.9-3.2 8.3-7.4.5-4.8-3-9.6-8.6-10.3zm4.5 13.2c-.4.4-1 .7-1.6.8-.3.1-.7.1-1 0-.9-.2-1.7-.6-2.5-1.1-1.5-1-2.8-2.3-3.6-3.9-.4-.8-.7-1.6-.7-2.5 0-.6.2-1.2.6-1.6.3-.4.8-.6 1.3-.6.2 0 .4 0 .5.1.2.1.3.2.4.4l1.3 1.8c.1.2.2.4.2.6 0 .2-.1.4-.3.6l-.4.4c-.1.1-.2.2-.2.3s0 .2.1.3c.4.7 1 1.3 1.6 1.8.3.2.5.2.7 0l.4-.4c.2-.2.4-.3.6-.3.2 0 .4.1.6.2l1.8 1.2c.2.1.3.3.4.5.1.4-.1.8-.2 1.4z"/></svg>
              </a>
              <a href="https://wa.me/380989225442" target="_blank" rel="noreferrer" className="contact-icon-btn contact-icon-btn--wa" aria-label="WhatsApp">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.64-.81-1.9-.9-.25-.1-.44-.14-.62.14-.18.28-.72.9-.88 1.09-.16.19-.32.21-.6.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.56-1.94-.16-.28-.02-.43.12-.57.13-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.05-.22-.54-.45-.47-.62-.47-.16 0-.35-.02-.53-.02s-.48.07-.73.34c-.25.28-.96.94-.96 2.3 0 1.35.98 2.66 1.12 2.84.14.18 1.93 2.94 4.67 4.13.65.28 1.16.45 1.56.57.65.21 1.25.18 1.72.11.52-.08 1.64-.67 1.87-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.19-.53-.33z"/><path d="M12.04 2C6.48 2 2 6.48 2 12.04c0 1.85.5 3.58 1.37 5.06L2 22l5.08-1.33A10.02 10.02 0 0012.04 22C17.6 22 22 17.52 22 12.04 22 6.48 17.6 2 12.04 2zm0 18.16c-1.7 0-3.28-.46-4.64-1.26l-.33-.2-3.42.9.91-3.34-.22-.34a8.15 8.15 0 01-1.28-4.38c0-4.5 3.66-8.16 8.16-8.16 4.5 0 8.16 3.66 8.16 8.16 0 4.5-3.66 8.16-8.16 8.16z"/></svg>
              </a>
            </div>
            <a href="https://www.google.com/maps/dir/?api=1&destination=Верховинна+44,+Київ" target="_blank" rel="noreferrer" className="contact-row">
              <div className="contact-ico loc">📍</div>
              <div style={{flex:1}}>
                <div className="contact-label">Адреса</div>
                <div className="contact-val">Київ, вул. Верховинна, 44</div>
              </div>
            </a>
          </div>
        </section>

        {/* MAP */}
        <section className="lsection">
          <div className="lsection-title">Як доїхати</div>
          <h2>Місце зустрічі</h2>
          <div className="map-card">
            <iframe
              className="map-iframe"
              src="https://www.google.com/maps?q=Верховинна+44,+Київ&output=embed"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Карта"
            ></iframe>
            <div className="map-overlay">
              <div className="map-pin">📍</div>
              <div>
                <div className="contact-label">Адреса</div>
                <div className="contact-val">Верховинна, 44</div>
              </div>
              <a href="https://www.google.com/maps/dir/?api=1&destination=Верховинна+44,+Київ" target="_blank" rel="noreferrer" className="map-route-btn">Маршрут</a>
            </div>
          </div>
        </section>

        {/* TERMS */}
        <section className="lsection">
          <button className="terms-btn" onClick={() => setTermsOpen(o => !o)}>
            <div className="terms-ico">📄</div>
            <div className="terms-btn-label">Умови відвідування уроків</div>
            <div className={`terms-chevron${termsOpen ? ' open' : ''}`}>›</div>
          </button>
          {termsOpen && (
            <div className="terms-content">
              <div className="terms-item">
                <div className="terms-num">1</div>
                <div>
                  <div className="terms-heading">Скасування та перенесення</div>
                  <div className="terms-text">Скасування або перенесення заняття можливі не пізніше ніж за 24 години до початку. У разі неявки учня без попередження — заняття підлягає компенсації в повному обсязі. Оплата здійснюється по завершенню заняття готівкою або переказом на картку.</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">2</div>
                <div>
                  <div className="terms-heading">Запізнення</div>
                  <div className="terms-text">У разі запізнення учня час заняття не продовжується.</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">3</div>
                <div>
                  <div className="terms-heading">Стан учня</div>
                  <div className="terms-text">До заняття не допускаються учні в стані алкогольного або наркотичного сп'яніння.</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">4</div>
                <div>
                  <div className="terms-heading">Документи</div>
                  <div className="terms-text">Учень зобов'язаний мати при собі документ, що посвідчує особу, а також водійське посвідчення (за наявності).</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">5</div>
                <div>
                  <div className="terms-heading">Відповідальність та безпека</div>
                  <div className="terms-text">Учень зобов'язаний дотримуватися вказівок інструктора, не перевищувати дозволену швидкість та правила дорожнього руху. Інструктор має право припинити заняття у разі створення загрози безпеці.</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">6</div>
                <div>
                  <div className="terms-heading">Погодні та дорожні умови</div>
                  <div className="terms-text">У разі несприятливих погодних умов або форс-мажорних обставин заняття може бути перенесене за домовленістю сторін.</div>
                </div>
              </div>
              <div className="terms-item">
                <div className="terms-num">7</div>
                <div>
                  <div className="terms-heading">Згода з умовами</div>
                  <div className="terms-text">Запис на заняття означає повну згоду з даними умовами.</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* FOOTER */}
        <div className="footer">
          <button className="footer-cta" onClick={goAuth}>🚗 Записатись зараз</button>
          <div>© 2026 ID4Drive. Школа водіння в Києві.</div>
          <div style={{marginTop:8,fontSize:13,fontWeight:600,letterSpacing:0.5,opacity:0.6}}>{APP_VERSION}</div>
        </div>

      </div>
    </div>
  )
}
