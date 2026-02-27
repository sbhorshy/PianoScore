import { Link } from 'react-router-dom'
import { useScores } from '../hooks/useScores'

export function Library() {
  const { scores, isLoading } = useScores()

  if (isLoading) {
    return <div className="text-center py-8">加载中...</div>
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">我的乐谱</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scores.map((score) => (
          <Link
            key={score.id}
            to={`/practice/${score.id}`}
            className="block bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold mb-2">{score.title}</h3>
            {score.composer && (
              <p className="text-gray-600 text-sm mb-2">{score.composer}</p>
            )}
            <div className="flex justify-between text-sm text-gray-500">
              <span>{score.measures.reduce((acc, m) => acc + m.notes.length, 0)} 音符</span>
              <span>♩ = {score.tempo}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
