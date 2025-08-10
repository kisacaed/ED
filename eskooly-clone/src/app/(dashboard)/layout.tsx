import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'

const nav: Array<{ href: Route; label: string }> = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/students', label: 'Students' },
  { href: '/teachers', label: 'Teachers' },
  { href: '/classes', label: 'Classes' },
  { href: '/attendance', label: 'Attendance' },
  { href: '/exams', label: 'Exams' },
  { href: '/fees', label: 'Fees' },
  { href: '/timetable', label: 'Timetable' },
  { href: '/announcements', label: 'Announcements' },
  { href: '/messages', label: 'Messages' },
  { href: '/reports', label: 'Reports' },
  { href: '/library', label: 'Library' },
  { href: '/transport', label: 'Transport' },
  { href: '/settings', label: 'Settings' },
]

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-[240px_1fr]">
      <aside className="border-r bg-white p-4">
        <div className="mb-6 text-lg font-semibold">School Manager</div>
        <nav className="grid gap-1 text-sm">
          {nav.map((item) => (
            <Link key={item.href} className="rounded px-2 py-1 hover:bg-muted" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="grid grid-rows-[56px_1fr]">
        <header className="flex items-center justify-between border-b bg-white px-4">
          <div className="font-medium">Dashboard</div>
          <Link href="/" className="text-sm text-gray-600 hover:underline">Home</Link>
        </header>
        <main className="bg-gray-50 p-4">{children}</main>
      </div>
    </div>
  )
}