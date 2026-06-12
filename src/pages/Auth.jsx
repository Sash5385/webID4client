import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendSmsCode, verifySmsCode, resetRecaptcha, getSmsErrorMessage, renderRecaptcha, isIOSDevice, isInAppBrowser } from '../firebase/auth'
import { signInWithEmail, signUpWithEmail, sendPasswordReset, signInWithGoogle } from '../firebase/auth-email'
import { saveUserProfile, getUserProfile } from '../firebase/db'
import { useTheme } from '../hooks/useTheme'
import { normalizePhone, formatPhone } from '../utils/format'
import './Auth.css'

const iosDevice = isIOSDevice()
const inAppBrowser = isInAppBrowser()

const TSCS = [
  { id: '8041', name: 'ТСЦ 8041', area: 'вул. Перемоги 20' },
  { id: '8042', name: 'ТСЦ 8042', area: 'вул. Мрії 19' },
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

  // iOS reCAPTCHA state
  const [captchaSolved, setCaptchaSolved] = useState(false)
  const [resendCaptchaNeeded, setResendCaptchaNeeded] = useState(false)

  // auth mode toggle: 'sms' | 'email-login' | 'email-register'
  const [authMode, setAuthMode] = useState('sms')

  // google
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')

  // forgot password
  const [resetMode, setResetMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [resetError, setResetError] = useState('')

  // survey step
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [surveyPhone, setSurveyPhone] = useState('')
  const [studentType, setStudentType] = useState('school')
  const [tscId, setTscId] = useState('8041')
  const [experience, setExperience] = useState('no_license')
  const [filmingConsent, setFilmingConsent] = useState(true)
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (user && !profile) setStep('survey')
  }, [user, profile])

  useEffect(() => {
    if (step === 'phone' && authMode === 'sms') {
      setCaptchaSolved(false)
      const onSolved = iosDevice ? () => setCaptchaSolved(true) : null
      const onExpired = iosDevice ? () => {
        setCaptchaSolved(false)
        setTimeout(() => renderRecaptcha('recaptcha-container', onSolved, onExpired).catch(() => {}), 100)
      } : null
      renderRecaptcha('recaptcha-container', onSolved, onExpired).catch(() => {})
    }
  }, [step, authMode])

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
      setPhoneError(getSmsErrorMessage(e.code))
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
        if (onProfileSaved) await onProfileSaved()
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
    await resetRecaptcha()

    if (iosDevice) {
      setResendCaptchaNeeded(true)
      // wait for div to mount, then render captcha with auto-send callback
      setTimeout(() => {
        renderRecaptcha('recaptcha-resend-container', async () => {
          setSending(true)
          try {
            await sendSmsCode(phone, 'recaptcha-resend-container')
            setResendTimer(45)
            setCode('')
          } catch (e) {
            setCodeError(getSmsErrorMessage(e.code))
          } finally {
            setResendCaptchaNeeded(false)
            setSending(false)
          }
        }).catch(() => {})
      }, 150)
      return
    }

    setSending(true)
    try {
      await sendSmsCode(phone, 'recaptcha-resend-container')
      setResendTimer(45)
      setCode('')
    } catch (e) {
      setCodeError(getSmsErrorMessage(e.code))
    } finally {
      setSending(false)
    }
  }

  // ─── SURVEY ──────────────────────────────────────────
  const handleSubmitSurvey = async () => {
    if (!name.trim()) { alert('Введи імʼя'); return }
    if (!surname.trim()) { alert('Введи прізвище'); return }
    if (!user?.phoneNumber && surveyPhone.trim().length !== 9) { alert('Введи коректний номер телефону'); return }
    if (!termsAgreed) { alert('Прийми умови користування'); return }

    setSavingProfile(true)
    try {
      const uid = user?.uid
      if (!uid) throw new Error('Користувач не авторизований')

      const data = {
        name: `${name.trim()} ${surname.trim()}`,
        phone: user.phoneNumber || `+380${surveyPhone.trim()}`,
        studentType,
        tscCenter: studentType === 'school' ? tscId : null,
        experience,
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

  // ─── GOOGLE ──────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setGoogleError('')
    setGoogleLoading(true)
    try {
      const u = await signInWithGoogle()
      const existing = await getUserProfile(u.uid)
      if (existing) {
        if (onProfileSaved) await onProfileSaved()
        nav('/cabinet')
      } else {
        setStep('survey')
      }
    } catch (e) {
      console.error(e)
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return
      if (e.code === 'auth/popup-blocked') {
        setGoogleError('Браузер заблокував вікно. Дозволь popup або використай SMS/Email')
      } else {
        setGoogleError('Не вдалось увійти через Google. Спробуй SMS або Email')
      }
    } finally {
      setGoogleLoading(false)
    }
  }

  const getEmailErrorMessage = (code) => {
    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential': return 'Невірний email або пароль'
      case 'auth/user-not-found': return 'Акаунт з таким email не знайдено'
      case 'auth/email-already-in-use': return 'Email вже використовується. Спробуй увійти'
      case 'auth/invalid-email': return 'Невірний формат email'
      case 'auth/too-many-requests': return 'Забагато спроб. Спробуй пізніше'
      case 'auth/weak-password': return 'Пароль занадто простий (мінімум 6 символів)'
      default: return 'Помилка. Перевір дані і спробуй ще раз'
    }
  }

  // ─── EMAIL LOGIN ──────────────────────────────────────
  const handleEmailLogin = async () => {
    setPhoneError('')
    if (!email || !password) { setPhoneError('Заповни обидва поля'); return }
    setSending(true)
    try {
      const u = await signInWithEmail(email, password)
      const existing = await getUserProfile(u.uid)
      if (existing) {
        if (onProfileSaved) await onProfileSaved()
        nav('/cabinet')
      } else {
        setStep('survey')
      }
    } catch (e) {
      console.error(e)
      setPhoneError(getEmailErrorMessage(e.code))
    } finally {
      setSending(false)
    }
  }

  // ─── EMAIL REGISTER ──────────────────────────────────────
  const handleEmailRegister = async () => {
    setPhoneError('')
    if (!email || !password) { setPhoneError('Заповни обидва поля'); return }
    if (password.length < 6) { setPhoneError('Пароль мінімум 6 символів'); return }
    setSending(true)
    try {
      const u = await signUpWithEmail(email, password)
      setStep('survey')
    } catch (e) {
      console.error(e)
      setPhoneError(getEmailErrorMessage(e.code))
    } finally {
      setSending(false)
    }
  }

  const handleSendReset = async () => {
    setResetError('')
    if (!resetEmail) { setResetError('Введи email'); return }
    setResetSending(true)
    try {
      await sendPasswordReset(resetEmail)
      setResetDone(true)
    } catch (e) {
      setResetError(e.code === 'auth/user-not-found' ? 'Акаунт з таким email не знайдено' : 'Помилка. Перевір email і спробуй ще раз')
    } finally {
      setResetSending(false)
    }
  }

  const [termsOpen, setTermsOpen] = useState(false)

  const stepNum = step === 'phone' ? 0 : step === 'sms' ? 1 : 2

  return (
    <div className="auth-page">

      {/* TOP BAR */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0'}}>
        <div style={{display:'flex',gap:6}}>
          {step === 'sms'
            ? <button className="back-btn" onClick={()=>{setStep('phone');resetRecaptcha()}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            : <button className="back-btn" onClick={() => nav(-1)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
          }
          <button className="back-btn" onClick={() => nav(1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div className="step-indicator">
          {[0,1,2].map(i => (
            <div key={i} className={`step-dot ${i===stepNum?'active':i<stepNum?'done':''}`}/>
          ))}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button className="back-btn" onClick={() => window.location.reload()} aria-label="Оновити" style={{border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button className="back-btn" onClick={toggle} style={{border:'none',cursor:'pointer',fontSize:16}}>
            {theme==='dark'?'🌙':'☀️'}
          </button>
        </div>
      </div>

      {/* ── PHONE / EMAIL ── */}
      {step === 'phone' && (
        <div className="fade-up" style={{display:'flex',flexDirection:'column'}}>
          <div className="auth-logo-block">
            <div className="auth-logo-icon"><img src="/icon-192.png" alt="ID4Drive"/></div>
            <div className="auth-logo-name">ID4Drive</div>
          </div>

          {/* Вкладки */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:20,background:'var(--surf-lo)',borderRadius:14,padding:4,boxShadow:'var(--shadow-in)'}}>
            {[
              {id:'sms', label:'📱 SMS'},
              {id:'email-login', label:'✉️ Email'},
            ].map(tab => {
              const isActive = tab.id === 'sms' ? authMode === 'sms' : (authMode === 'email-login' || authMode === 'email-register')
              return (
                <button key={tab.id} onClick={()=>{setAuthMode(tab.id);setPhoneError('')}} style={{
                  padding:'9px 0',borderRadius:11,border:'none',cursor:'pointer',fontWeight:700,fontSize:12,
                  background:isActive?'var(--surface)':'transparent',
                  color:isActive?'var(--text)':'var(--dim)',
                  boxShadow:isActive?'var(--shadow)':'none',transition:'all .15s'
                }}>{tab.label}</button>
              )
            })}
          </div>

          {/* Google */}
          {!inAppBrowser && (
            <div style={{marginBottom:8}}>
              <button
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
                style={{
                  display:'flex',alignItems:'center',justifyContent:'center',gap:10,
                  width:'100%',padding:'12px 0',borderRadius:14,border:'1.5px solid var(--border)',
                  background:'var(--surface)',cursor:'pointer',fontSize:15,fontWeight:600,
                  color:'var(--text)',boxShadow:'var(--shadow)',transition:'all .15s'
                }}
              >
                {googleLoading ? (
                  <span style={{fontSize:14,color:'var(--dim)'}}>Завантаження...</span>
                ) : (<>
                  <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.7 0 6.7 5.5 2.8 13.5l7.8 6.1C12.5 13.2 17.8 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.7 37.3 46.5 31.3 46.5 24.5z"/>
                    <path fill="#FBBC05" d="M10.6 28.4A14.9 14.9 0 0 1 9.5 24c0-1.5.3-3 .7-4.4l-7.8-6.1A23.9 23.9 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1-.1-.3z"/>
                    <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.2 0-11.5-3.7-13.4-9.1l-7.8 6.1C6.7 42.5 14.7 48 24 48z"/>
                  </svg>
                  Увійти через Google
                </>)}
              </button>
              {googleError && <div className="auth-error" style={{marginTop:8}}>{googleError}</div>}
              <div style={{display:'flex',alignItems:'center',gap:10,margin:'14px 0 4px'}}>
                <div style={{flex:1,height:1,background:'var(--border)'}}/>
                <span style={{fontSize:12,color:'var(--dim)'}}>або</span>
                <div style={{flex:1,height:1,background:'var(--border)'}}/>
              </div>
            </div>
          )}

          {authMode === 'sms' ? (<>
            <h1 className="auth-h1">Введи свій <span className="acc">телефон</span></h1>
            <p className="auth-sub">Надішлемо SMS-код для підтвердження.</p>
            {inAppBrowser && (
              <div style={{background:'#fff3cd',border:'1px solid #ffc107',borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:13,color:'#856404',lineHeight:1.5}}>
                ⚠️ Viber-браузер може блокувати SMS. Відкрий у <b>Safari</b> або скористайся <b>Email</b>.
              </div>
            )}
            <div className="phone-card">
              <div className="phone-flag">UA</div>
              <div className="phone-code">+380</div>
              <input
                className="phone-input"
                type="tel"
                placeholder="__ ___ ____"
                maxLength={9}
                inputMode="numeric"
                value={phoneInput}
                onChange={e=>setPhoneInput(e.target.value.replace(/\D/g,'').slice(0,9))}
                autoFocus
              />
            </div>
            <div id="recaptcha-container" style={{marginTop:8}}/>
            {iosDevice && phoneInput.length >= 9 && !captchaSolved && (
              <p style={{fontSize:11,color:'var(--dim)',textAlign:'center',marginTop:4}}>
                Відмітьте reCAPTCHA вище щоб продовжити
              </p>
            )}
            {phoneError && <div className="auth-error">{phoneError}</div>}
            <div style={{marginTop:16}}>
              <button className="btn-primary" onClick={handleSendCode}
                disabled={sending || phoneInput.length < 9 || (iosDevice && !captchaSolved)}>
                {sending ? 'Надсилаємо...' : 'Надіслати код →'}
              </button>
            </div>
          </>) : authMode === 'email-login' ? (
            resetMode ? (<>
              <h1 className="auth-h1">{resetDone ? <>Лист <span className="acc">надіслано</span></> : <>Відновлення <span className="acc">паролю</span></>}</h1>
              {resetDone ? (<>
                <div style={{textAlign:'center',marginTop:24}}>
                  <div style={{fontSize:56,marginBottom:16}}>📬</div>
                  <p className="auth-sub">Перевір <b>{resetEmail}</b><br/>і перейди за посиланням у листі.</p>
                </div>
                <div style={{marginTop:'auto'}}>
                  <button className="btn-primary" onClick={()=>{setResetMode(false);setResetDone(false);setResetEmail('')}}>
                    Повернутись →
                  </button>
                </div>
              </>) : (<>
                <p className="auth-sub">Вкажи email — надішлемо посилання для зміни паролю.</p>
                <div className="field">
                  <div className="field-label">Email</div>
                  <input className="text-input" type="email" placeholder="you@example.com"
                    value={resetEmail} onChange={e=>setResetEmail(e.target.value)} autoFocus inputMode="email"/>
                </div>
                {resetError && <div className="auth-error">{resetError}</div>}
                <div style={{marginTop:16,display:'flex',flexDirection:'column',gap:10}}>
                  <button className="btn-primary" onClick={handleSendReset} disabled={resetSending||!resetEmail}>
                    {resetSending ? 'Надсилаємо...' : 'Надіслати посилання →'}
                  </button>
                  <button onClick={()=>{setResetMode(false);setResetError('')}} style={{
                    background:'none',border:'none',color:'var(--dim)',fontSize:13,cursor:'pointer',padding:'6px 0'
                  }}>← Назад</button>
                </div>
              </>)}
            </>) : (<>
              <h1 className="auth-h1">Вхід через <span className="acc">Email</span></h1>
              <p className="auth-sub">Введи пошту та пароль від свого акаунту.</p>
              <div className="field">
                <div className="field-label">Email</div>
                <input className="text-input" type="email" placeholder="you@example.com" autoComplete="email"
                  value={email} onChange={e=>setEmail(e.target.value)} autoFocus inputMode="email"/>
              </div>
              <div className="field">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <div className="field-label" style={{margin:0}}>Пароль</div>
                  <button onClick={()=>{setResetMode(true);setResetEmail(email);setResetError('');setResetDone(false)}} style={{
                    background:'none',border:'none',color:'var(--accent)',fontSize:12,cursor:'pointer',fontWeight:700,padding:0
                  }}>Забули пароль?</button>
                </div>
                <input className="text-input" type="password" placeholder="Ваш пароль"
                  value={password} onChange={e=>setPassword(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&handleEmailLogin()}/>
              </div>
              {phoneError && <div className="auth-error">{phoneError}</div>}
              <div style={{marginTop:16,display:'flex',flexDirection:'column',gap:10}}>
                <button className="btn-primary" onClick={handleEmailLogin} disabled={sending||!email||!password}>
                  {sending?'Входимо...':'Увійти →'}
                </button>
                <div style={{display:'flex',alignItems:'center',gap:12,margin:'4px 0'}}>
                  <div style={{flex:1,height:1,background:'var(--border)'}}/>
                  <span style={{fontSize:12,color:'var(--dim)'}}>немає акаунту?</span>
                  <div style={{flex:1,height:1,background:'var(--border)'}}/>
                </div>
                <button onClick={()=>{setAuthMode('email-register');setPhoneError('')}} style={{
                  background:'var(--surf-lo)',border:'2px solid var(--accent)',borderRadius:14,
                  color:'var(--accent)',fontWeight:700,cursor:'pointer',fontSize:16,padding:'12px 0',
                  boxShadow:'var(--shadow)',transition:'all .15s'
                }}>Зареєструватись →</button>
              </div>
            </>)
          ) : (<>
            <h1 className="auth-h1">Реєстрація через <span className="acc">Email</span></h1>
            <p className="auth-sub">Введи пошту та придумай пароль.</p>
            <div className="field">
              <div className="field-label">Email</div>
              <input className="text-input" type="email" placeholder="you@example.com"
                value={email} onChange={e=>setEmail(e.target.value)} autoFocus inputMode="email"/>
            </div>
            <div className="field">
              <div className="field-label">Пароль</div>
              <input className="text-input" type="password" placeholder="Мінімум 6 символів"
                value={password} onChange={e=>setPassword(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleEmailRegister()}/>
            </div>
            {phoneError && <div className="auth-error">{phoneError}</div>}
            <div style={{marginTop:16}}>
              <button className="btn-primary" onClick={handleEmailRegister} disabled={sending||!email||!password}>
                {sending?'Реєструємось...':'Зареєструватись →'}
              </button>
            </div>
            <p style={{textAlign:'center',fontSize:13,color:'var(--dim)',marginTop:16}}>
              Вже є акаунт?{' '}
              <button onClick={()=>{setAuthMode('email-login');setPhoneError('')}} style={{
                background:'none',border:'none',color:'var(--accent)',fontWeight:700,cursor:'pointer',fontSize:13,padding:0
              }}>Увійти</button>
            </p>
          </>)}
        </div>
      )}

      {/* ── SMS ── */}
      {step === 'sms' && (
        <div className="fade-up" style={{display:'flex',flexDirection:'column'}}>
          <h1 className="auth-h1" style={{marginTop:16}}>Код з <span className="acc">SMS</span></h1>
          <p className="auth-sub">Надіслали на {formatPhone(phone)}</p>
          <div className="code-grid" onClick={()=>codeInputRef.current?.focus()}>
            {Array(6).fill(null).map((_,i)=>(
              <div key={i} className={`code-cell${i<code.length?' filled':''}${i===code.length?' active':''}`}>
                {code[i]||''}
              </div>
            ))}
          </div>
          <input
            ref={codeInputRef}
            className="code-input-hidden"
            type="tel"
            maxLength={6}
            inputMode="numeric"
            value={code}
            onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
            autoFocus
          />
          <div className="timer-row">
            {resendTimer>0
              ? <>Повторно надіслати через <span className="accent">{resendTimer} сек</span></>
              : <button className="resend-link" onClick={handleResend} disabled={sending||resendCaptchaNeeded}>{sending?'Надсилаємо...':'Надіслати ще раз'}</button>
            }
          </div>
          {resendCaptchaNeeded && (
            <div style={{marginTop:12,textAlign:'center'}}>
              <p style={{fontSize:12,color:'var(--dim)',marginBottom:8}}>Підтвердіть для повторного відправлення</p>
              <div id="recaptcha-resend-container" style={{display:'block'}}/>
            </div>
          )}
          {!iosDevice && <div id="recaptcha-resend-container" style={{height:0,overflow:'hidden'}}/>}
          {codeError && <div className="auth-error">{codeError}</div>}
          <div className="bottom-spacer">
            <button className="btn-primary" onClick={handleVerifyCode} disabled={verifying||code.length<6}>
              {verifying?'Перевіряємо...':'Підтвердити →'}
            </button>
          </div>
        </div>
      )}

      {/* ── SURVEY ── */}
      {step === 'survey' && (
        <div className="fade-up" style={{display:'flex',flexDirection:'column'}}>
          <h1 className="auth-h1" style={{marginTop:8}}>Розкажи <span className="acc">про себе</span></h1>
          <p className="auth-sub">Допоможе підібрати програму навчання</p>

          <div className="field">
            <div className="field-label">Імʼя *</div>
            <input className="text-input" type="text" placeholder="Олександр" value={name} onChange={e=>setName(e.target.value)} autoFocus/>
          </div>

          <div className="field">
            <div className="field-label">Прізвище *</div>
            <input className="text-input" type="text" placeholder="Петренко" value={surname} onChange={e=>setSurname(e.target.value)}/>
          </div>

          {!user?.phoneNumber && (
            <div className="field">
              <div className="field-label">Телефон *</div>
              <div className="phone-card" style={{marginTop:0}}>
                <div className="phone-flag">UA</div>
                <div className="phone-code">+380</div>
                <input
                  className="phone-input"
                  type="tel"
                  placeholder="__ ___ ____"
                  maxLength={9}
                  inputMode="numeric"
                  value={surveyPhone}
                  onChange={e=>setSurveyPhone(e.target.value.replace(/\D/g,'').slice(0,9))}
                />
              </div>
            </div>
          )}

          <div className="field">
            <div className="field-label">Тип навчання</div>
            <div className="choice-grid">
              {[
                {id:'school', icon:'🎓', title:'Автошкола', desc:'40 годин', bg:'linear-gradient(165deg,#5b9bff,#2563eb)'},
                {id:'private', icon:'🚗', title:'Приватний урок', desc:'Індивідуальне навчання', bg:'linear-gradient(165deg,#fb923c,#ea580c)'},
              ].map(t=>(
                <div key={t.id} className={`tile-pick${studentType===t.id?' selected':''}`} onClick={()=>setStudentType(t.id)}>
                  <div className="ico" style={{background:t.bg}}>{t.icon}</div>
                  <div className="tile-title">{t.title}</div>
                  <div className="tile-desc">{t.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {studentType==='school' && (
            <div className="field">
              <div className="field-label">ТСЦ для іспиту</div>
              <div className="select-list">
                {TSCS.map(t=>(
                  <div key={t.id} className={`select-item${tscId===t.id?' selected':''}`} onClick={()=>setTscId(t.id)}>
                    <div className="select-radio"/>
                    <div className="select-info">
                      <div className="select-title">{t.name}</div>
                      <div className="select-sub">{t.area}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {studentType === 'private' && (
            <div className="field">
              <div className="field-label">Досвід водіння</div>
              <div className="select-list">
                {EXPERIENCES.map(ex=>(
                  <div key={ex.id} className={`select-item${experience===ex.id?' selected':''}`} onClick={()=>setExperience(ex.id)}>
                    <div className="select-radio"/>
                    <div className="select-info">
                      <div className="select-title">{ex.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="toggle-row" onClick={()=>setFilmingConsent(v=>!v)}>
            <div className="toggle-ico">🎬</div>
            <div className="toggle-info">
              <div className="toggle-title">Зйомка відео/аудіо для реклами автошколи</div>
            </div>
            <button className={`switch${filmingConsent?' on':''}`} onClick={e=>{e.stopPropagation();setFilmingConsent(v=>!v)}}>
              <div className="switch-knob"/>
            </button>
          </div>

          <button className={`terms-survey-btn${termsAgreed?' agreed':''}`} onClick={()=>termsAgreed?setTermsAgreed(false):setTermsOpen(v=>!v)}>
            <div className="terms-survey-ico">{termsAgreed?'✓':'📋'}</div>
            <div className="terms-survey-text">
              <div className="lbl">{termsAgreed?'Прийнято':'Обовʼязково'}</div>
              <div>{termsAgreed?'Умови прийнято':'Переглянути умови'}</div>
            </div>
          </button>

          {termsOpen && !termsAgreed && (
            <div style={{background:'var(--surface)',borderRadius:14,padding:'14px 16px',marginTop:-8,marginBottom:12,boxShadow:'var(--shadow)'}}>
              <pre style={{fontSize:12,lineHeight:1.7,color:'var(--dim)',whiteSpace:'pre-wrap',fontFamily:'inherit',margin:0,maxHeight:200,overflowY:'auto'}}>{TERMS_TEXT}</pre>
              <button className="btn-primary" style={{marginTop:12}} onClick={()=>{setTermsAgreed(true);setTermsOpen(false)}}>
                Погоджуюсь ✓
              </button>
            </div>
          )}

          <div className="bottom-spacer">
            <button className="btn-primary" onClick={handleSubmitSurvey} disabled={savingProfile||!termsAgreed}>
              {savingProfile?'Зберігаємо...':'Завершити реєстрацію →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
