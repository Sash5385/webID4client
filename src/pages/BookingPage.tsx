import { useState } from 'react'
import { ref, set, push, update } from 'firebase/database'
import { auth, db } from '../firebase'
import type { TimeSlot } from '../types'
import Step2DateTime from './Step2DateTime'
import Step3Form from './Step3Form'
import { usePrices } from '../hooks/usePrices'
import { useProfileContext } from '../App'
import CityAnimation from '../components/CityAnimation'

interface BookingState {
  durationHours: number
  price: number
  serviceName: string
  date: string
  slot: TimeSlot | null
}

export default function BookingPage() {
  const { serviceType, profile, saveQuestionnaire } = useProfileContext()
  const needsQuestionnaire = !profile?.questionnaireCompleted
  const [step, setStep] = useState(needsQuestionnaire ? 1 : 2)
  const [booking, setBooking] = useState<BookingState>({
    durationHours: 0, price: 0, serviceName: '', date: '', slot: null,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const prices = usePrices()

  async function handleStep1(data: { drivingExperience: string; lessonGoals: string[]; comment: string; wantsFilming: boolean }) {
    await saveQuestionnaire({ drivingExperience: data.drivingExperience, lessonGoals: data.lessonGoals, wantsFilming: data.wantsFilming })
    setStep(2)
  }

  function handleStep2(date: string, slot: TimeSlot, durationHours: number) {
    const price = serviceType === 'private'
      ? durationHours === 1 ? prices.private_1h : prices.private_2h
      : durationHours === 1 ? prices.school_1h : prices.school_2h
    const serviceName = serviceType === 'private'
      ? `Приватний урок ${durationHours} год`
      : `Урок автошколи ${durationHours} год`
    const data = { ...booking, date, slot, durationHours, price, serviceName }
    setBooking(data)
    submitBooking(data)
  }

  async function submitBooking(data: BookingState) {
    const uid = auth.currentUser?.uid
    if (!uid || !data.slot) return
    setSubmitting(true)
    setError('')
    try {
      const bookingRef = push(ref(db, `bookings/${uid}`))
      const id = bookingRef.key ?? ''
      await set(bookingRef, {
        id, userId: uid,
        serviceName: data.serviceName,
        serviceType,
        durationHours: data.durationHours,
        price: data.price,
        date: data.date,
        time: data.slot.time,
        drivingExperience: profile?.drivingExperience ?? 'no_license',
        studentName: '',
        phone: auth.currentUser?.phoneNumber ?? '',
        comment: '',
        lessonGoals: profile?.lessonGoals ?? [],
        wantsFilming: profile?.wantsFilming ?? false,
        status: 'confirmed',
        createdAt: Date.now(),
      })
      await update(ref(db, `timeslots/${data.date}/${data.slot.id}`), { available: false })
      if (data.durationHours === 2) {
        const [h, m] = data.slot.time.split(':').map(Number)
        const next = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        const nextId = `slot${next.replace(':', '')}`
        await update(ref(db, `timeslots/${data.date}/${nextId}`), { available: false })
      }
      setDone(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full mb-6 rounded-2xl overflow-hidden"><CityAnimation /></div>
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-white text-xl font-bold mb-2">Ви записані!</h2>
      <p className="text-gray-400 text-center mb-6">
        {booking.serviceName} · {booking.date} о {booking.slot?.time}
      </p>
      <p className="text-blue-400 font-semibold text-lg mb-8">{booking.price} грн</p>
      <button
        onClick={() => { setDone(false); setStep(needsQuestionnaire ? 1 : 2); setBooking({ durationHours: 0, price: 0, serviceName: '', date: '', slot: null }) }}
        className="glare bg-gray-800 text-white font-semibold rounded-xl px-8 py-3"
      >
        ← Записатись ще раз
      </button>
    </div>
  )

  const totalSteps = needsQuestionnaire ? 2 : 1
  const currentStep = needsQuestionnaire ? step : step - 1

  return (
    <div>
      <div className="flex gap-1 px-4 pt-4 max-w-md mx-auto mb-2">
        {Array(totalSteps).fill(null).map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i + 1 <= currentStep ? 'bg-blue-600' : 'bg-gray-700'}`} />
        ))}
      </div>
      {error && <p className="text-red-400 text-sm text-center px-4 mb-2">{error}</p>}
      {submitting && <p className="text-gray-400 text-sm text-center px-4 mb-2">Збереження...</p>}
      {step === 1 && needsQuestionnaire && (
        <Step3Form
          serviceType={serviceType ?? 'school'}
          onNext={handleStep1}
          onBack={() => {}}
        />
      )}
      {step === 2 && (
        <Step2DateTime
          serviceType={serviceType ?? 'school'}
          onNext={handleStep2}
          onBack={() => needsQuestionnaire ? setStep(1) : {}}
        />
      )}
    </div>
  )
}