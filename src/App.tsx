import { createContext, useContext } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import type { UserProfile } from './hooks/useProfile'
import LoginPage from './pages/LoginPage'
import BookingPage from './pages/BookingPage'
import MyBookingsPage from './pages/MyBookingsPage'
import Step1Service from './pages/Step1Service'
import { useFCM } from './hooks/useFCM'

export const ProfileContext = createContext<{
  serviceType: 'school' | 'private' | null
  profile: UserProfile | null
  saveServiceType: (t: 'school' | 'private') => Promise<void>
  saveQuestionnaire: (data: { drivingExperience: string; lessonGoals: string[]; wantsFilming: boolean }) => Promise<void>
}>({ serviceType: null, profile: null, saveServiceType: async () => {}, saveQuestionnaire: async () => {} })

export function useProfileContext() { return useContext(ProfileContext) }

function FCMInit() { useFCM(); return null }

export default function App() {
  const { user, loading: authLoading } = useAuth()
  const { profile, loading: profileLoading, saveServiceType, saveQuestionnaire } = useProfile(user)

  if (authLoading || (user && profileLoading)) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Завантаження...</p>
    </div>
  )

  if (!user) return (
    <div className="min-h-screen bg-gray-950">
      <LoginPage />
    </div>
  )

  if (!profile?.serviceType) return (
    <div className="min-h-screen bg-gray-950">
      <Step1Service onNext={saveServiceType} />
    </div>
  )

  return (
    <ProfileContext.Provider value={{ serviceType: profile.serviceType, profile, saveServiceType, saveQuestionnaire }}>
      <FCMInit />
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <header className="glare bg-gray-900 px-4 py-3 flex items-center justify-between border-b border-gray-800">
          <a href="https://id4drive.pro" style={{textDecoration:"none"}}>
            <h1 className="text-white font-bold text-lg">ID4Drive</h1>
            <p className="text-gray-500 text-xs">Онлайн-запис</p>
          </a>
          <button
            onClick={() => signOut(auth)}
            className="glare text-gray-400 text-sm hover:text-white bg-gray-800 px-3 py-1 rounded-xl"
          >
            Вийти
          </button>
        </header>

        <main className="flex-1 overflow-y-auto pb-32">
          <Routes>
            <Route path="/" element={<Navigate to="/booking" replace />} />
            <Route path="/booking" element={<BookingPage />} />
            <Route path="/my-bookings" element={<MyBookingsPage />} />
          </Routes>
        </main>

        <nav className="glare fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 flex">
          <NavLink to="/booking" className={({ isActive }) =>
            `flex-1 py-8 text-center text-xl font-semibold transition-all ${isActive ? 'text-blue-400' : 'text-gray-400 hover:text-gray-300'}`
          }>
            + Записатись
          </NavLink>
          <NavLink to="/my-bookings" className={({ isActive }) =>
            `flex-1 py-8 text-center text-xl font-semibold transition-all ${isActive ? 'text-blue-400' : 'text-gray-400 hover:text-gray-300'}`
          }>
            Мої записи
          </NavLink>
        </nav>
      </div>
    </ProfileContext.Provider>
  )
}