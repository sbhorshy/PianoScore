import { Link, useLocation } from 'react-router-dom'

export function Navigation() {
  const location = useLocation()
  
  const navItems = [
    { path: '/', label: '乐谱库' },
    { path: '/ai-transcribe', label: 'AI 识谱' },
    { path: '/settings', label: '设置' },
  ]

  return (
    <nav className="bg-white shadow">
      <div className="container mx-auto px-4">
        <ul className="flex space-x-6">
          {navItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`block py-3 px-2 border-b-2 transition-colors ${
                  location.pathname === item.path
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-blue-600'
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
