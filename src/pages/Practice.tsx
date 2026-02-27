import { useParams } from 'react-router-dom'
import { useScores } from '../hooks/useScores'
import { usePractice } from '../hooks/usePractice'
import { useMIDI } from '../hooks/useMIDI'
import { Staff } from '../components/Staff'
import { useEffect } from 'react'

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

  useEffect(() => {
    if (lastNoteEvent?.type === 'noteOn' && isPlaying) {
      checkNote(lastNoteEvent)
    }
  }, [lastNoteEvent, isPlaying, checkNote])

  if (!score) {
    return <div>乐谱不存在</div>
  }

  const notes = score.measures.flatMap((m) => m.notes)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">{score.title}</h2>
          {score.composer && <p className="text-gray-600">{score.composer}</p>}
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-green-600">正确: {correctCount}</span>
          <span className="text-red-600">错误: {wrongCount}</span>
        </div>
      </div>

      {/* MIDI Status */}
      {!isSupported && (
        <div className="bg-yellow-100 text-yellow-800 p-4 rounded">
          您的浏览器不支持 Web MIDI API
        </div>
      )}
      
      {isSupported && !isConnected && (
        <div className="bg-blue-50 p-4 rounded">
          <p className="mb-2">选择 MIDI 设备:</p>
          <div className="flex gap-2">
            {devices.map((device) => (
              <button
                key={device.id}
                onClick={() => connect(device)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {device.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Staff */}
      <Staff notes={notes} currentNoteIndex={currentNoteIndex} />

      {/* Feedback */}
      {lastResult && (
        <div className="text-center py-4">
          {lastResult === 'correct' && (
            <span className="text-2xl font-bold text-green-600">✓ 正确!</span>
          )}
          {lastResult === 'wrongPitch' && (
            <span className="text-2xl font-bold text-red-600">✗ 音高错误</span>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-center gap-4">
        <button
          onClick={reset}
          className="px-6 py-3 bg-gray-200 rounded-lg hover:bg-gray-300"
        >
          重置
        </button>
        
        {isPlaying ? (
          <button
            onClick={stop}
            className="px-8 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            停止
          </button>
        ) : (
          <button
            onClick={start}
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            开始练习
          </button>
        )}
      </div>
    </div>
  )
}
