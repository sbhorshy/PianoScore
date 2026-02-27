import { ReactNode } from 'react'
import { Navigation } from './Navigation'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-600 text-white shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">PianoScore</h1>
        </div>
      </header>
      
      <Navigation />
      
      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
