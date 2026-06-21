import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import PracticePage from '@/pages/PracticePage'
import LibraryPage from '@/pages/LibraryPage'
import AIScanPage from '@/pages/AIScanPage'
import SettingsPage from '@/pages/SettingsPage'
import './App.css'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/practice/:scoreId" element={<PracticePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/import" element={<AIScanPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App
