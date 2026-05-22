import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import UnifiedDashboard from './UnifiedDashboard.jsx'
import PerBotDashboard from './components/PerBotDashboard.jsx'
import { usePolyBot } from './hooks/usePolyBot.js'
import './index.css'
import './components/PerBotDashboard.css'

// Get bot name from URL path
function getBotNameFromPath() {
  const path = window.location.pathname
  if (path.startsWith('/bot/')) {
    return path.split('/')[2]
  }
  if (path.startsWith('/dashboard/')) {
    return path.split('/')[2]
  }
  return null
}

// Check if we should show per-bot dashboard
function shouldShowPerBotDashboard() {
  const path = window.location.pathname
  return path.startsWith('/bot/') || path.startsWith('/dashboard/bot')
}

// Check unified mode
const isUnified = import.meta.env.VITE_UNIFIED_MODE === 'true' || 
                 window.location.pathname === '/unified'

// Bot name for per-bot dashboard
const botName = getBotNameFromPath()

// Render the appropriate dashboard
function Dashboard() {
  if (isUnified) {
    return <UnifiedDashboard />
  }
  
  if (shouldShowPerBotDashboard() && botName) {
    const { stats, positions, markets, config, gas, salary, history, log, btc5m, connected, resumeGas } = usePolyBot(botName)
    
    if (!stats) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'var(--bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--mono)',
          color: 'var(--text3)',
          fontSize: '12px'
        }}>
          Connecting to {botName}...
        </div>
      )
    }
    
    return (
      <PerBotDashboard
        botName={botName}
        stats={stats}
        positions={positions}
        markets={markets}
        config={config}
        gas={gas}
        salary={salary}
        history={history}
        log={log}
        btc5m={btc5m}
        connected={connected}
        onResumeGas={resumeGas}
      />
    )
  }
  
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>
)