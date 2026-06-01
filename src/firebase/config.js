import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

// Беремо з .env (Vite автоматично підставляє import.meta.env.VITE_*)
// Якщо .env немає — fallback на дефолти (треба підставити вручну)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDO6-LTuBoNHi6uS5KcOpmBuyvgJSouYpk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "id4drive-booking-44182.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://id4drive-booking-44182-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "id4drive-booking-44182",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "id4drive-booking-44182.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "815176240686",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:815176240686:web:1cf54d6c465420230199bf"
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getDatabase(app)
