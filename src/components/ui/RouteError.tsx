'use client'

/**
 * Shared route-level error boundary body. Each route group re-exports this from
 * its own error.tsx so a thrown error in a server page (all admin pages are
 * force-dynamic and query on render) shows a recoverable UI instead of crashing
 * to the bare global error page.
 */
export default function RouteError({ reset, title }: { reset: () => void; title?: string }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-bold text-zinc-900 mb-2">{title ?? 'Something went wrong'}</h1>
        <p className="text-sm text-zinc-500 mb-6">
          An unexpected error occurred while loading this page. You can try again.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
