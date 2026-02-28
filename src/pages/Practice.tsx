import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useScores } from '../hooks/useScores'
import { usePractice } from '../hooks/usePractice'
import { useMIDI } from '../hooks/useMIDI'
import { Staff } from '../components/Staff'
import { ChevronLeft, Settings, RotateCcw, Play, Pause } from 'lucide-react'

export function Practice() {
  const { scoreId } = useParams<{ scoreId: string }>()
  const { getScore } = useScores()
  const score = getScore(scoreId || '')
  
  const {
    currentNoteIndex,
    isPlaying,
    lastResult,
    correctCount,
    wrongCount,
    start,
    stop,
    reset,
    checkNote,
  } = usePractice(score!)
  
  const { isSupported, isConnected, devices, connect, lastNoteEvent } = useMIDI()
  const [showMidiPanel, setShowMidiPanel] = useState(false)

  useEffect(() => {
    if (lastNoteEvent?.type === 'noteOn' && isPlaying) {
      checkNote(lastNoteEvent)
    }
  }, [lastNoteEvent, isPlaying, checkNote])

  if (!score) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-400 text-lg">乐谱不存在</p>
      </div>
    )
  }

  const notes = score.measures.flatMap((m) => m.notes)
  const progress = Math.round((currentNoteIndex / notes.length) * 100)

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Bar - Apple Style */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center text-blue-600 hover:opacity-70 transition-opacity">
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm">返回</span>
          </Link>
          
          <h1 className="text-lg font-semibold text-gray-900 truncate max-w-xs">
            {score.title}
          </h1>
          
          <button className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 pb-32">
        {/* Stats Cards - Apple Style */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-50 rounded-2xl p-4 text-center">
            <p className="text-3xl font-semibold text-green-600">{correctCount}</p>
            <p className="text-xs text-gray-500 mt-1 uppercase tracking-wide">正确</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4 text-center">
            <p className="text-3xl font-semibold text-red-500">{wrongCount}</p>
            <p className="text-xs text-gray-500 mt-1 uppercase tracking-wide">错误</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-4 text-center">
            <p className="text-3xl font-semibold text-blue-600">{progress}%</p>
            <p className="text-xs text-gray-500 mt-1 uppercase tracking-wide">进度</p>
          </div>
        </div>

        {/* MIDI Status Panel */}
        {isSupported && !isConnected && (
          <div className="mb-6 bg-blue-50 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">连接 MIDI 设备</p>
                <p className="text-xs text-gray-500 mt-0.5">选择你的电子钢琴或 MIDI 键盘</p>
              </div>
              <button
                onClick={() => setShowMidiPanel(!showMidiPanel)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-full hover:bg-blue-700 transition-colors"
              >
                选择设备
              </button>
            </div>
            
            {showMidiPanel && devices.length > 0 && (
              <div className="mt-4 space-y-2">
                {devices.map((device) => (
                  <button
                    key={device.id}
                    onClick={() => { connect(device); setShowMidiPanel(false) }}
                    className="w-full text-left px-4 py-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <p className="text-sm font-medium text-gray-900">{device.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isConnected && (
          <div className="mb-6 flex items-center gap-2 text-green-600 bg-green-50 rounded-full px-4 py-2 w-fit">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium">已连接 MIDI</span>
          </div>
        )}

        {/* Staff Display */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 mb-8">
          <Staff notes={notes} currentNoteIndex={currentNoteIndex} />
        </div>

        {/* Feedback */}
        {lastResult && (
          <div className="mb-8 text-center">
            {lastResult === 'correct' && (
              <div className="inline-flex items-center gap-2 px-6 py-3 bg-green-100 rounded-full">
                <span className="text-lg font-semibold text-green-700">正确!</span>
              </div>
            )}
            {lastResult === 'wrongPitch' && (
              <div className="inline-flex items-center gap-2 px-6 py-3 bg-red-100 rounded-full">
                <span className="text-lg font-semibold text-red-700">音高错误</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Control Bar - Fixed Bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-center gap-6">
          <button
            onClick={reset}
            className="flex flex-col items-center gap-1 p-3 rounded-2xl hover:bg-gray-100 transition-colors active:scale-95"
          >
            <RotateCcw className="w-6 h-6 text-gray-600" />
            <span className="text-xs text-gray-500">重置</span>
          </button>

          {isPlaying ? (
            <button
              onClick={stop}
              className="flex items-center gap-2 px-8 py-4 bg-red-500 text-white rounded-full font-semibold shadow-lg shadow-red-500/30 hover:bg-red-600 transition-all active:scale-95"
            >
              <Pause className="w-6 h-6" />
              <span>停止</span>
            </button>
          ) : (
            <button
              onClick={start}
              className="flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-full font-semibold shadow-lg shadow-blue-600/30 hover:bg-blue-700 transition-all active:scale-95"
            >
              <Play className="w-6 h-6" />
              <span>开始练习</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
