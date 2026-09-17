// =============================================================================
// src/lib/blog/scope.ts
//
// Which blog a piece of work belongs to (autoblog-parity XM-11).
//
//   null          → Xmartmenu's own marketing blog at /blog. Reader: a
//                   restaurant owner we are selling to.
//   <tenant uuid> → that restaurant's blog at /<slug>/blog. Reader: a diner,
//                   and the point is local SEO.
//
// WHY THIS FILE EXISTS: in PostgREST, `tenant_id = NULL` matches nothing.
// Filtering the platform scope needs `.is('tenant_id', null)`, and a single
// `.eq('tenant_id', scope)` written by habit would silently return ZERO rows for
// the platform — or, on a write, create a row belonging to no scope that every
// reader then ignores. Worse, a forgotten filter returns EVERY tenant's rows.
//
// So the filter is never spelled by hand. `scopeFilter` is the only way to
// narrow a query, and `scopeColumn` the only way to write the column.
// =============================================================================

/** null is the platform's own blog. A uuid is one restaurant's. */
export type BlogScope = string | null

/**
 * The two builder methods this needs. Deliberately NOT `T extends
 * ScopedQuery<T>`: Supabase's builder types are self-referential and deeply
 * generic, and that constraint makes tsc give up with "type instantiation is
 * excessively deep". Structural typing on the two methods is enough, and the
 * return cast is safe because both of them return the same builder.
 */
/**
 * The two builder methods this needs.
 *
 * Deliberately NOT generic over the builder: Supabase's query-builder types are
 * self-referential and deeply generic, and threading them through a type
 * parameter makes tsc give up with "type instantiation is excessively deep".
 * The value passed in and the value handed back are the same object, so the
 * caller's own type is preserved by the `as T` at the single call boundary —
 * structural typing on eq/is is all the checking this needs to be correct.
 */
interface ScopedQueryMethods {
  eq(column: string, value: unknown): unknown
  is(column: string, value: null): unknown
}

/**
 * Narrow a query to one scope. Use it on EVERY read and every scoped write:
 *
 *   scopeFilter(svc.from('blog_posts').select('*'), scope)
 */
export function scopeFilter<T>(query: T, scope: BlogScope): T {
  const q = query as unknown as ScopedQueryMethods
  return (scope === null ? q.is('tenant_id', null) : q.eq('tenant_id', scope)) as T
}

/** The column value for an insert. Spelled once so no caller omits it. */
export function scopeColumn(scope: BlogScope): { tenant_id: string | null } {
  return { tenant_id: scope }
}

/** True for the platform's own blog. Reads better than `scope === null` at call sites. */
export function isPlatformScope(scope: BlogScope): boolean {
  return scope === null
}

/** For log lines and job metadata. */
export function describeScope(scope: BlogScope): string {
  return scope === null ? 'platform' : `tenant:${scope}`
}
