export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">Login</h1>
        <form className="grid gap-3">
          <input className="w-full rounded border p-2" placeholder="Email" />
          <input className="w-full rounded border p-2" placeholder="Password" type="password" />
          <button className="rounded bg-primary px-4 py-2 text-white">Sign in</button>
        </form>
      </div>
    </main>
  )
}