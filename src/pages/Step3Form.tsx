import { useState } from 'react'

interface FormData {
  drivingExperience: string
  lessonGoals: string[]
  comment: string
  wantsFilming: boolean
}

interface Props {
  serviceType: 'school' | 'private'
  onNext: (data: FormData) => void
  onBack: () => void
}

const GOALS = [
  { id: 'crossroads', label: 'Проїзд перехресть' },
  { id: 'parking', label: 'Паркування' },
  { id: 'turns', label: 'Розвороти' },
  { id: 'route', label: 'Проїзд власного маршруту' },
]

const EXPERIENCE_OPTIONS = [
  { id: 'no_license', label: 'Не маю посвідчення, збираюсь складати іспит' },
  { id: 'has_license', label: 'Маю посвідчення, не маю досвіду водіння' },
]

const TERMS = `Умови відвідування уроків водіння

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

export default function Step3Form({ serviceType, onNext, onBack }: Props) {
  const [drivingExperience, setDrivingExperience] = useState('no_license')
  const [lessonGoals, setLessonGoals] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [wantsFilming, setWantsFilming] = useState(true)
  const [termsAccepted, setTermsAccepted] = useState(false)

  function toggleGoal(id: string) {
    setLessonGoals(prev => prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id])
  }

  return (
    <div className="p-4 max-w-md mx-auto">
      <h2 className="text-white text-lg font-bold text-center mb-4">Досвід водіння</h2>
      <div className="glare bg-gray-900 rounded-2xl p-4 mb-6">
        {EXPERIENCE_OPTIONS.map((o, i) => (
          <div key={o.id}>
            <button
              onClick={() => setDrivingExperience(o.id)}
              className="w-full flex items-center justify-between py-3 text-left"
            >
              <span className="text-white text-sm">{o.label}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 ml-3 transition-all flex items-center justify-center ${
                drivingExperience === o.id ? 'border-blue-500' : 'border-gray-600'
              }`}>
                {drivingExperience === o.id && <div className="w-3 h-3 rounded-full bg-blue-500" />}
              </div>
            </button>
            {i < EXPERIENCE_OPTIONS.length - 1 && <div className="border-b border-gray-800" />}
          </div>
        ))}
      </div>

      {serviceType === 'private' && (
        <>
          <h2 className="text-white text-lg font-bold text-center mb-4">ЦІЛІ УРОКУ</h2>
          <div className="glare bg-gray-900 rounded-2xl p-4 mb-6">
            <p className="text-gray-500 text-sm text-center mb-4">Можна обрати декілька</p>
            {GOALS.map((g, i) => (
              <div key={g.id}>
                <button
                  onClick={() => toggleGoal(g.id)}
                  className="w-full flex items-center justify-between py-3 text-left"
                >
                  <span className="text-white">{g.label}</span>
                  <div className={`w-6 h-6 rounded-md border-2 transition-all flex items-center justify-center ${
                    lessonGoals.includes(g.id) ? 'border-blue-500 bg-blue-500' : 'border-gray-600'
                  }`}>
                    {lessonGoals.includes(g.id) && <span className="text-white text-xs">✓</span>}
                  </div>
                </button>
                {i < GOALS.length - 1 && <div className="border-b border-gray-800" />}
              </div>
            ))}
            <textarea
              className="glare w-full bg-gray-800 text-white rounded-xl px-4 py-3 mt-4 outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
              rows={3}
              placeholder="Свій коментар..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
        </>
      )}

      <div className="glare bg-gray-900 rounded-2xl p-4 mb-6">
        <button
          onClick={() => setWantsFilming(v => !v)}
          className="w-full flex items-center gap-3 text-left"
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 transition-all flex items-center justify-center ${
            wantsFilming ? 'border-blue-500 bg-blue-500' : 'border-gray-600'
          }`}>
            {wantsFilming && <span className="text-white text-xs">✓</span>}
          </div>
          <span className="text-gray-300 text-sm">Дозволяю публікацію фото і відео для реклами автошколи</span>
        </button>
      </div>

      <div className="glare bg-gray-900 rounded-2xl p-4 mb-6">
        <h2 className="text-white text-sm font-bold mb-3">Умови використання</h2>
        <div className="bg-gray-800 rounded-xl p-3 mb-4 h-40 overflow-y-auto">
          <pre className="text-gray-400 text-xs whitespace-pre-wrap font-sans leading-relaxed">{TERMS}</pre>
        </div>
        <button
          onClick={() => setTermsAccepted(v => !v)}
          className="w-full flex items-center gap-3 text-left"
        >
          <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 transition-all flex items-center justify-center ${
            termsAccepted ? 'border-blue-500 bg-blue-500' : 'border-gray-600'
          }`}>
            {termsAccepted && <span className="text-white text-xs">✓</span>}
          </div>
          <span className="text-gray-300 text-sm">Я ознайомився та погоджуюсь з умовами</span>
        </button>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="glare flex-1 bg-gray-800 text-white font-semibold rounded-xl py-3">
          ← Назад
        </button>
        <button
          disabled={!termsAccepted}
          onClick={() => onNext({ drivingExperience, lessonGoals, comment, wantsFilming })}
          className={`glare flex-1 font-semibold rounded-xl py-3 transition-all ${
            termsAccepted ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          Далі →
        </button>
      </div>
    </div>
  )
}