import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/library', label: 'Library' },
  { path: '/import', label: '导入曲谱' },
  { path: '/settings', label: 'Settings' },
]

export function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="container mx-auto px-4 py-2 flex gap-2 border-b">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path
        return (
          <button
            key={item.path}
            className={cn(
              buttonVariants({
                variant: isActive ? 'secondary' : 'ghost',
                size: 'sm',
              }),
              'relative'
            )}
            onClick={() => navigate(item.path)}
          >
            {item.label}
            {isActive && (
              <motion.div
                layoutId="nav-underline"
                className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
