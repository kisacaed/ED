import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'School Manager',
  description: 'A legally-safe Eskooly-like school management starter',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
      </body>
    </html>
  )
}