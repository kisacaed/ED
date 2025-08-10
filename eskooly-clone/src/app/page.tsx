import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <section className="rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-semibold">School Manager Starter</h1>
        <p className="mb-6 text-gray-600">
          This is an open, legally-safe starter inspired by school management platforms.
        </p>
        <div className="flex gap-3">
          <Link className="rounded bg-primary px-4 py-2 text-white" href="/login">Login</Link>
          <Link className="rounded border px-4 py-2" href="/dashboard">Go to Dashboard</Link>
        </div>
      </section>
    </main>
  )
}