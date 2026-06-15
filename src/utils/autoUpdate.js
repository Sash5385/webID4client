const VERSION_KEY = 'id4drive-app-version'
const CHECK_INTERVAL = 60000 // 1 minute

export function initAutoUpdate() {
  // Store current version on load
  const buildTime = new Date().getTime().toString()
  localStorage.setItem(VERSION_KEY, buildTime)

  // Check for updates every minute
  setInterval(checkForUpdates, CHECK_INTERVAL)
}

async function checkForUpdates() {
  try {
    // Fetch a file with cache-busting to check if new version exists
    const response = await fetch('/manifest.json?t=' + Date.now())
    if (!response.ok) return

    const manifest = await response.json()
    const serverVersion = manifest.version || new Date().getTime().toString()
    const clientVersion = localStorage.getItem(VERSION_KEY)

    // If versions differ, reload the page
    if (clientVersion && serverVersion !== clientVersion) {
      localStorage.setItem(VERSION_KEY, serverVersion)
      // Give user a moment to notice, then reload silently
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    }
  } catch (error) {
    // Silently fail - user doesn't need to know about network errors
  }
}

// Also check on visibility change (when user comes back to tab)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdates()
    }
  })
}
