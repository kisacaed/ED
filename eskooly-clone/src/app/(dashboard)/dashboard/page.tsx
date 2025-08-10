export default function DashboardPage() {
  const cards = [
    { title: 'Students', value: 0 },
    { title: 'Teachers', value: 0 },
    { title: 'Classes', value: 0 },
    { title: 'Attendance Today', value: '—' },
  ]
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.title} className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="text-sm text-gray-500">{c.title}</div>
            <div className="text-2xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}