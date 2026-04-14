export default function PendingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="bg-white border border-zinc-200 rounded-2xl p-10 max-w-md w-full text-center">
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-zinc-900 mb-2">Account under review</h1>
        <p className="text-sm text-zinc-500 mb-6">
          Your access has not been configured yet. Please contact support or wait for your account to be activated by an administrator.
        </p>
        <a
          href="/auth/login"
          className="inline-block text-sm font-medium text-zinc-600 hover:text-zinc-900 underline"
        >
          Back to login
        </a>
      </div>
    </div>
  )
}
