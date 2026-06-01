import Auth from './Auth'

export default function BookPage({ user, profile, onProfileSaved }) {
  return <Auth user={user} profile={profile} onProfileSaved={onProfileSaved} />
}
