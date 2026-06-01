import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { sendSmsCode, verifySmsCode, resetRecaptcha } from '../firebase/auth'
import { signInWithEmail, signUpWithEmail } from '../firebase/auth-email'
import { saveUserProfile, getUserProfile } from '../firebase/db'
import { useTheme } from '../hooks/useTheme'
import { normalizePhone, formatPhone } from '../utils/format'
import './Auth.css'

const TSCS = [
  { id: '8045', name: 'ТСЦ 8045', area: 'Святошинський р-н, вул. Тулузи 1' },
  { id: '8042', name: 'ТСЦ 8042', area: 'Соломʼянський р-н, вул. Героїв Севастополя' },
  { id: '8043', name: 'ТСЦ 8043', area: 'Деснянський р-н, вул. Берковецька' },
]

const EXPERIENCES = [
  { id: 'no_license', name: 'Не маю посвідчення, збираюсь складати іспит' },
  { id: 'has_license', name: 'Маю посвідчення, не маю досвіду водіння' },
]

const TERMS_TEXT = `Умови відвідування уроків водіння

1. Скасування та перенесення:
Скасування або перенесення заняття можливі не пізніше ніж за 24 години до початку.
У разі неявки учня на заняття без попередження, заняття підлягає компенсації в повному обсязі.
Оплата здійснюється по завершенню заняття готівкою або переказом на картку.

2. Запізнення:
У разі запізнення учня час заняття не продовжується.

3. Стан учня:
До заняття не допускаються учні в стані алкогольного або наркотичного сп'яніння.

4. Документи:
Учень зобов'язаний мати при собі документ, що посвідчує особу, а також водійське посвідчення (за наявності).

5. Відповідальність та безпека:
Учень зобов'язаний дотримуватися вказівок інструктора, не перевищувати дозволену швидкість та правила дорожнього руху.
Інструктор має право припинити заняття у разі створення загрози безпеці.

6. Погодні та дорожні умови:
У разі несприятливих погодних умов або форс-мажорних обставин заняття може бути перенесене за домовленістю сторін.

7. Згода з умовами:
Запис на заняття означає повну згоду з даними умовами.`

export default function Auth({ user, profile, onProfileSaved }) {
  const { theme, toggle } = useTheme()
  const nav = useNavigate()

  // step: 'phone' | 'sms' | 'survey'
  const [step, setStep] = useState(user && !profile ? 'survey' : 'phone')
  
  // email step
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // phone step
  const [phoneInput, setPhoneInput] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [sending, setSending] = useState(false)

  // sms step
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [resendTimer, setResendTimer] = useState(45)
  const codeInputRef = useRef(null)

  // survey step
  const [name, setName] = useState('')
  const [studentType, setStudentType] = useState('school')
  const [tscId, setTscId] = useState('8045')
  const [experience, setExperience] = useState('no_license')
  const [filmingConsent, setFilmingConsent] = useState(true)
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (user && !profile) setStep('survey')
  }, [user, profile])

  useEffect(() => {
    if (step === 'sms' && resendTimer > 0) {
      const t = setInterval(() => setResendTimer(p => p - 1), 1000)
      return () => clearInterval(t)
    }
  }, [step, resendTimer])

  useEffect(() => {
    if (step === 'sms' && codeInputRef.current) codeInputRef.current.focus()
  }, [step])

  // ─── PHONE ───────────────────────────────────────────
  const handleSendCode = async () => {
    setPhoneError('')
    const normalized = normalizePhone('+380' + phoneInput)
    if (!normalized) {
      setPhoneError('Введи коректний номер')
      return
    }
    setSending(true)
    try {
      await sendSmsCode(normalized)
      setPhone(normalized)
      setStep('sms')
      setResendTimer(45)
    } catch (e) {
      console.error(e)
      setPhoneError(e.message || 'Не вдалось надіслати SMS')
      await resetRecaptcha()
    } finally {
      setSending(false)
    }
  }

  // ─── SMS ─────────────────────────────────────────────
  const handleVerifyCode = async () => {
    setCodeError('')
    if (code.length !== 6) {
      setCodeError('Введи 6-значний код')
      return
    }
    setVerifying(true)
    try {
      const u = await verifySmsCode(code)
      const existing = await getUserProfile(u.uid)
      if (existing) {
        nav('/cabinet')
      } else {
        setStep('survey')
      }
    } catch (e) {
      console.error(e)
      setCodeError('Невірний код')
    } finally {
      setVerifying(false)
    }
  }

  const handleResend = async () => {
    setCodeError('')
    setSending(true)
    try {
      await resetRecaptcha()
      await sendSmsCode(phone)
      setResendTimer(45)
      setCode('')
    } catch (e) {
      setCodeError(e.message || 'Не вдалось повторно надіслати')
    } finally {
      setSending(false)
    }
  }

  // ─── SURVEY ──────────────────────────────────────────
  const handleSubmitSurvey = async () => {
    if (!name.trim()) { alert('Введи імʼя'); return }
    if (!termsAgreed) { alert('Прийми умови користування'); return }
    
    setSavingProfile(true)
    try {
      const uid = user?.uid
      if (!uid) throw new Error('Користувач не авторизований')

      const data = {
        name: name.trim(),
        phone: user.phoneNumber || phone || email,
        studentType,
        tscCenter: studentType === 'school' ? tscId : null,
        experience: studentType === 'private' ? experience : null,
        filmingConsent,
        termsAccepted: true,
        createdAt: Date.now()
      }

      await saveUserProfile(uid, data)
      if (onProfileSaved) await onProfileSaved()
      nav('/cabinet')
    } catch (e) {
      console.error(e)
      alert('Не вдалось зберегти профіль')
    } finally {
      setSavingProfile(false)
    }
  }

  // ─── EMAIL AUTH ──────────────────────────────────────
  const handleEmailAuth = async () => {
    setPhoneError('')
    if (!email || !password) { 
      setPhoneError('Заповни обидва поля')
      return 
    }
    if (password.length < 6) {
      setPhoneError('Пароль мінімум 6 символів')
      return
    }
    setSending(true)
    try {
      let u
      try {
        u = await signInWithEmail(email, password)
      } catch {
        u = await signUpWithEmail(email, password)
      }
      const existing = await getUserProfile(u.uid)
      if (existing) {
        nav('/cabinet')
      } else {
        setStep('survey')
      }
    } catch (e) {
      console.error(e)
      setPhoneError(e.message || 'Помилка входу')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <Link to="/" className="auth-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </Link>

        <button className="theme-toggle" onClick={toggle}>
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>

        <div className="auth-logo">
          <div className="logo-icon">🚗</div>
          <div className="logo-text">ID4Drive</div>
        </div>

        {/* PHONE STEP */}
        {step === 'phone' && (
          <div className="fade-up" style={{display:'flex', flexDirection:'column', flex:1}}>
            <header className="auth-header">
              <div className="step-indicator">Крок 1 з 3</div>
              <h1 className="auth-title">Введи свій <span className="highlight">телефон</span></h1>
              <p className="auth-subtitle">Надішлемо SMS-код для підтвердження. Без паролів і email — лише номер.</p>
            </header>

            <div className="auth-body">
              <div className="phone-input-group">
                <div className="phone-code">+380</div>
                <input
                  className="phone-input"
                  type="tel"
                  placeholder="98 922 5442"
                  maxLength={13}
                  inputMode="numeric"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  autoFocus
                />
              </div>

              <div id="recaptcha-container"></div>

              {phoneError && <div style={{color:'var(--accent)',fontSize:'13px',marginTop:'8px'}}>{phoneError}</div>}
              
            </div>

            <div className="bottom-spacer">
              <button className="btn-primary" onClick={handleSendCode} disabled={sending || phoneInput.length < 9}>
                {sending ? 'Надсилаємо...' : 'Надіслати код →'}
              </button>
            </div>
          </div>
        )}

        {/* SMS STEP */}
        {step === 'sms' && (
          <div className="fade-up" style={{display:'flex', flexDirection:'column', flex:1}}>
            <header className="auth-header">
              <button className="back-btn" onClick={() => { setStep('phone'); resetRecaptcha(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="step-indicator">Крок 2 з 3</div>
              <h1 className="auth-title">Введи <span className="highlight">код</span> з SMS</h1>
              <p className="auth-subtitle">Надіслали на {formatPhone(phone)}</p>
            </header>

            <div className="auth-body">
              <input
                ref={codeInputRef}
                className="code-input"
                type="tel"
                placeholder="• • • • • •"
                maxLength={6}
                inputMode="numeric"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
              {codeError && <div style={{color:'var(--accent)',fontSize:'13px',marginTop:'8px'}}>{codeError}</div>}

              {resendTimer > 0 ? (
                <div className="resend-timer">Повторно надіслати через {resendTimer} сек</div>
              ) : (
                <button className="resend-btn" onClick={handleResend} disabled={sending}>
                  {sending ? 'Надсилаємо...' : 'Надіслати ще раз'}
                </button>
              )}
            </div>

            <div className="bottom-spacer">
              <button className="btn-primary" onClick={handleVerifyCode} disabled={verifying || code.length < 6}>
                {verifying ? 'Перевіряємо...' : 'Підтвердити →'}
              </button>
            </div>
          </div>
        )}

        {/* SURVEY STEP */}
        {step === 'survey' && (
          <div className="fade-up" style={{display:'flex', flexDirection:'column', flex:1}}>
            <header className="auth-header">
              <div className="step-indicator">Крок 3 з 3</div>
              <h1 className="auth-title">Розкажи про себе</h1>
              <p className="auth-subtitle">Допоможе підібрати програму навчання</p>
            </header>

            <div className="auth-body survey-form">
              <div className="form-group">
                <label className="form-label">Твоє імʼя</label>
                <input
                  type="text"
                  placeholder="Олександр"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Тип навчання</label>
                <div className="radio-group">
                  <label className={`radio-card ${studentType === 'school' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="studentType"
                      value="school"
                      checked={studentType === 'school'}
                      onChange={e => setStudentType(e.target.value)}
                    />
                    <div className="radio-content">
                      <div className="radio-icon">🎓</div>
                      <div>
                        <div className="radio-title">Автошкола</div>
                        <div className="radio-desc">Повний курс з ТСЦ, 40 годин</div>
                      </div>
                    </div>
                  </label>
                  <label className={`radio-card ${studentType === 'private' ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="studentType"
                      value="private"
                      checked={studentType === 'private'}
                      onChange={e => setStudentType(e.target.value)}
                    />
                    <div className="radio-content">
                      <div className="radio-icon">🚗</div>
                      <div>
                        <div className="radio-title">Приватні уроки</div>
                        <div className="radio-desc">Індивідуальний графік, 1 або 2 години</div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {studentType === 'school' && (
                <div className="form-group">
                  <label className="form-label">ТСЦ для складання іспиту</label>
                  <select value={tscId} onChange={e => setTscId(e.target.value)} className="form-select">
                    {TSCS.map(t => (
                      <option key={t.id} value={t.id}>{t.name} — {t.area}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Досвід водіння</label>
                {EXPERIENCES.map(ex => (
                  <label key={ex.id} className="toggle-label" style={{marginBottom:8}}>
                    <input
                      type="radio"
                      name="experience"
                      value={ex.id}
                      checked={experience === ex.id}
                      onChange={() => setExperience(ex.id)}
                    />
                    <span>{ex.name}</span>
                  </label>
                ))}
              </div>

              <div className="form-group">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={filmingConsent}
                    onChange={e => setFilmingConsent(e.target.checked)}
                  />
                  <span>Згоден на зйомку для соцмереж (Instagram, TikTok)</span>
                </label>
              </div>

              <div className="form-group" id="terms">
                <label className="form-label">Умови використання</label>
                <div style={{background:'var(--surface)',borderRadius:10,padding:'10px 12px',maxHeight:160,overflowY:'auto',marginBottom:10,fontSize:12,lineHeight:1.6,color:'var(--dim)',whiteSpace:'pre-wrap'}}>
                  {TERMS_TEXT}
                </div>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={termsAgreed}
                    onChange={e => setTermsAgreed(e.target.checked)}
                  />
                  <span>Я ознайомився та погоджуюсь з умовами</span>
                </label>
              </div>
            </div>

            <div className="bottom-spacer">
              <button 
                className="btn-primary" 
                onClick={handleSubmitSurvey} 
                disabled={savingProfile || !termsAgreed}
              >
                {savingProfile ? 'Зберігаємо...' : 'Завершити реєстрацію →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
