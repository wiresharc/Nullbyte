import { Routes, Route } from 'react-router-dom'
import Upload from './components/Upload'
import Download from './components/Download'
import Navbar from './components/Navbar'

export default function App() {
  return (
    <div className="min-h-screen bg-mesh">
      <Navbar />
      <main className="relative">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/download/:token" element={<Download />} />
        </Routes>
      </main>
    </div>
  )
}
