import { useState, useEffect } from 'react'
import { ref, get, update } from 'firebase/database'
import type { User } from 'firebase/auth'
import { db } from '../firebase'

export interface UserProfile {
  serviceType: 'school' | 'private' | null
  questionnaireCompleted: boolean
  drivingExperience: string
  lessonGoals: string[]
  wantsFilming: boolean
}

export function useProfile(user: User | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    get(ref(db, `users/${user.uid}/profile`)).then((snap) => {
      if (snap.exists()) {
        const v = snap.val()
        setProfile({
          serviceType: v.serviceType ?? null,
          questionnaireCompleted: v.questionnaireCompleted ?? false,
          drivingExperience: v.drivingExperience ?? 'no_license',
          lessonGoals: v.lessonGoals ?? [],
          wantsFilming: v.wantsFilming ?? true,
        })
      } else {
        setProfile({ serviceType: null, questionnaireCompleted: false, drivingExperience: 'no_license', lessonGoals: [], wantsFilming: true })
      }
    }).finally(() => setLoading(false))
  }, [user])

  async function saveServiceType(serviceType: 'school' | 'private') {
    if (!user) return
    await update(ref(db, `users/${user.uid}/profile`), { serviceType })
    setProfile(p => p ? { ...p, serviceType } : p)
  }

  async function saveQuestionnaire(data: { drivingExperience: string; lessonGoals: string[]; wantsFilming: boolean }) {
    if (!user) return
    await update(ref(db, `users/${user.uid}/profile`), { ...data, questionnaireCompleted: true })
    setProfile(p => p ? { ...p, ...data, questionnaireCompleted: true } : p)
  }

  return { profile, loading, saveServiceType, saveQuestionnaire }
}