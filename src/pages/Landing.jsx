import { Link, useNavigate } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import './Landing.css'

export default function Landing({ user }) {
  const { theme, toggle } = useTheme()
  const nav = useNavigate()

  const goAuth = () => nav(user ? '/cabinet' : '/schedule')

  return (
    <div className="landing-page">

      {/* TOP BAR */}
      <header className="landing-topbar">
        <div className="container landing-topbar-row">
          <div className="logo">
            <div className="logo-icon">🚗</div>
            ID4Drive
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" onClick={toggle} aria-label="Тема">
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              )}
            </button>
            <button className="btn-login" onClick={goAuth}>
              {user ? 'Кабінет' : 'Увійти'}
            </button>
          </div>
        </div>
      </header>

      <div className="container">

        {/* HERO */}
        <section className="hero">
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
        </section>

        {/* SERVICES */}
        <section className="lsection">
          <div className="lsection-title">Послуги</div>
          <h2>Обери свій формат</h2>
          <div className="services">
            <div className="service-card" onClick={goAuth}>
              <div className="service-icon ico-school">🎓</div>
              <div className="service-info">
                <div className="service-title">Автошкола</div>
                <div className="service-desc">Повний курс з ТСЦ, 40 годин, документи</div>
              </div>
              <div className="service-arrow">→</div>
            </div>
            <div className="service-card" onClick={goAuth}>
              <div className="service-icon ico-private">🚙</div>
              <div className="service-info">
                <div className="service-title">Приватні уроки</div>
                <div className="service-desc">Індивідуально, гнучкий графік, 1 або 2 години</div>
              </div>
              <div className="service-arrow">→</div>
            </div>
          </div>
        </section>

        {/* FLOW */}
        <section className="lsection">
          <div className="lsection-title">Як це працює</div>
          <h2>Один вибір — твій шлях</h2>
          <div className="flow-card">

            <div className="flow-step">
              <div className="flow-num">1</div>
              <div className="flow-body">
                <div className="flow-title">Реєстрація по SMS або Email</div>
                <div className="flow-desc">Один раз вводиш номер телефону або email</div>
              </div>
            </div>

            <div className="flow-step">
              <div className="flow-num">2</div>
              <div className="flow-body">
                <div className="flow-title">Анкета — обери тип</div>
                <div className="flow-desc">В анкеті один раз вибираєш формат. Змінити не можна.</div>
                <div className="flow-choice">
                  <div className="choice-tile active">
                    <div className="ico">🎓</div>
                    Автошкола
                  </div>
                  <div className="choice-tile">
                    <div className="ico">🚙</div>
                    Приватний
                  </div>
                </div>
              </div>
            </div>

            <div className="flow-step">
              <div className="flow-num">3</div>
              <div className="flow-body">
                <div className="flow-title">Автошкола: 40 уроків</div>
                <div className="flow-desc">Проходиш повний курс з ТСЦ і документами</div>
                <div className="flow-progress">
                  <div className="flow-progress-bar"></div>
                </div>
                <div className="flow-progress-label">
                  <span>26 / 40 годин</span>
                  <span style={{color:'var(--green)'}}>65%</span>
                </div>
              </div>
            </div>

            <div className="flow-arrow">↓</div>

            <div className="flow-step">
              <div className="flow-num">4</div>
              <div className="flow-body">
                <div className="flow-title">Авто-перехід на приватні</div>
                <div className="flow-desc">Після 40 уроків автошколи відкриваються приватні уроки — для шліфування навичок</div>
              </div>
            </div>

          </div>
        </section>

        {/* FEATURES */}
        <section className="lsection">
          <div className="lsection-title">Переваги</div>
          <h2>Чому обирають мене</h2>
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
          </div>
        </section>

        {/* INSTRUCTOR */}
        <section className="lsection">
          <div className="lsection-title">Інструктор</div>
          <h2>Олександр</h2>
          <div className="instructor-card">
            <div className="instructor-avatar">ОЛ</div>
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
          <div className="review-card">
            <div className="review-stars">★★★★★</div>
            <div className="review-text">"Олександр — найкращий інструктор! Здала з першого разу. Спокійно пояснює, не нервує."</div>
            <div className="review-author">
              <div className="review-avatar">АН</div>
              <div>
                <div className="review-name">Анна К.</div>
                <div className="review-date">15 травня 2026</div>
              </div>
            </div>
          </div>
          <div className="review-card">
            <div className="review-stars">★★★★★</div>
            <div className="review-text">"Зручний додаток для запису. Перенесла урок за 30 секунд, без дзвінків. Рекомендую!"</div>
            <div className="review-author">
              <div className="review-avatar" style={{background:'linear-gradient(165deg,#fb923c,#ea580c)'}}>МК</div>
              <div>
                <div className="review-name">Марія Г.</div>
                <div className="review-date">2 травня 2026</div>
              </div>
            </div>
          </div>
          <div className="review-card">
            <div className="review-stars">★★★★★</div>
            <div className="review-text">"Брав приватні уроки після курсів. За 5 занять став впевнено водити в місті."</div>
            <div className="review-author">
              <div className="review-avatar" style={{background:'linear-gradient(165deg,#5b9bff,#2563eb)'}}>ДМ</div>
              <div>
                <div className="review-name">Дмитро П.</div>
                <div className="review-date">20 квітня 2026</div>
              </div>
            </div>
          </div>
        </div>

        {/* CONTACTS */}
        <section className="lsection">
          <div className="lsection-title">Контакти</div>
          <h2>Звʼязатись зі мною</h2>
          <div className="contacts">
            <a href="tel:+380989225442" className="contact-row">
              <div className="contact-ico tel">📞</div>
              <div style={{flex:1}}>
                <div className="contact-label">Телефон</div>
                <div className="contact-val">+380 98 922 5442</div>
              </div>
            </a>
            <a href="https://t.me/id4drive" target="_blank" rel="noreferrer" className="contact-row">
              <div className="contact-ico tg">✈️</div>
              <div style={{flex:1}}>
                <div className="contact-label">Telegram</div>
                <div className="contact-val">@id4drive</div>
              </div>
            </a>
            <a href="viber://chat?number=%2B380989225442" className="contact-row">
              <div className="contact-ico" style={{background:'linear-gradient(165deg,#8b5cf6,#6d28d9)'}}>💬</div>
              <div style={{flex:1}}>
                <div className="contact-label">Viber</div>
                <div className="contact-val">+380 98 922 5442</div>
              </div>
            </a>
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
          <button className="terms-btn">
            <div className="terms-ico">📄</div>
            <div style={{flex:1, textAlign:'left'}}>
              <div className="contact-label">Документи</div>
              <div className="contact-val">Умови надання послуг</div>
            </div>
            <div style={{color:'var(--faint)'}}>→</div>
          </button>
        </section>

        {/* FOOTER */}
        <div className="footer">
          <button className="footer-cta" onClick={goAuth}>🚗 Записатись зараз</button>
          <div>© 2026 ID4Drive. Школа водіння в Києві.</div>
        </div>

      </div>
    </div>
  )
}
