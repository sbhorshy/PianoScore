import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Library } from './pages/Library'
import { Practice } from './pages/Practice'
import { Settings } from './pages/Settings'
import { AITranscribe } from './pages/AITranscribe'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/practice/:scoreId" element={<Practice />} />
        <Route path="/ai-transcribe" element={<AITranscribe />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default App
