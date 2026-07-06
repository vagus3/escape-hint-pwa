import { useEffect, useMemo, useState } from 'react'
import { AdminPage } from './AdminPage.jsx'
import { HintApp } from './HintApp.jsx'

export function App() {
  const [toast, setToast] = useState('')
  const isAdminRoute = useMemo(() => window.location.pathname.startsWith('/admin'), [])

  useEffect(() => {
    function onToast(event) {
      setToast(event.detail)
      window.setTimeout(() => setToast(''), 3000)
    }
    window.addEventListener('app-toast', onToast)
    return () => window.removeEventListener('app-toast', onToast)
  }, [])

  return (
    <>
      {isAdminRoute ? <AdminPage /> : <HintApp />}
      {toast && <div id="toast-container"><div className="toast">{toast}</div></div>}
    </>
  )
}
