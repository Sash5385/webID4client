import { useEffect, useState } from 'react'
import { subscribeMyBookings, getConfirmedSchoolHours, getCompletedHours } from '../firebase/db'

export function useBookings(uid) {
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setBookings([])
      setLoading(false)
      return
    }
    setLoading(true)
    const unsub = subscribeMyBookings(uid, (list) => {
      // Сортуємо: найближчі першими
      list.sort((a, b) => {
        const dateA = new Date(`${a.date}T${a.time || '00:00'}`)
        const dateB = new Date(`${b.date}T${b.time || '00:00'}`)
        return dateA - dateB
      })
      setBookings(list)
      setLoading(false)
    })
    return unsub
  }, [uid])

  const schoolHours = getConfirmedSchoolHours(bookings)
  const completedHours = getCompletedHours(bookings)
  const upcoming = bookings.filter(b => b.status !== 'cancelled' && new Date(b.date) >= new Date(new Date().toDateString()))
  const completed = bookings.filter(b => b.status === 'confirmed' && new Date(b.date) < new Date())

  return {
    bookings,
    upcoming,
    completed,
    schoolHours,
    completedHours,
    loading,
    canBookPrivate: schoolHours >= 40
  }
}
