import Link from 'next/link'
import { Building2, MapPin, Phone, Clock } from 'lucide-react'

interface BranchLocation {
  id: string
  name: string
  slug: string
  address: string | null
  city: string | null
  phone: string | null
  business_hours: Record<string, string> | null
}

interface Props {
  tenantName: string
  tenantSlug: string
  locations: BranchLocation[]
}

export default function BranchPicker({ tenantName, tenantSlug, locations }: Props) {
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-start py-16 px-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-zinc-950 tracking-tight mb-2">{tenantName}</h1>
          <p className="text-sm font-bold text-zinc-500">Choose a location to view the menu</p>
        </div>

        <div className="space-y-4">
          {locations.map(loc => (
            <Link
              key={loc.id}
              href={`/${tenantSlug}/${loc.slug}`}
              className="group flex items-center gap-5 bg-white border border-zinc-100 rounded-[1.25rem] p-6 shadow-sm hover:border-primary hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary transition-colors duration-200">
                <Building2 className="w-6 h-6 text-primary group-hover:text-zinc-950 transition-colors duration-200" />
              </div>

              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-black text-zinc-950 tracking-tight group-hover:text-primary transition-colors">{loc.name}</h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                  {(loc.address || loc.city) && (
                    <span className="flex items-center gap-1 text-xs font-medium text-zinc-400">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {[loc.address, loc.city].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {loc.phone && (
                    <span className="flex items-center gap-1 text-xs font-medium text-zinc-400">
                      <Phone className="w-3 h-3 shrink-0" />
                      {loc.phone}
                    </span>
                  )}
                  {loc.business_hours && Object.values(loc.business_hours).some(Boolean) && (
                    <span className="flex items-center gap-1 text-xs font-medium text-zinc-400">
                      <Clock className="w-3 h-3 shrink-0" />
                      Open today
                    </span>
                  )}
                </div>
              </div>

              <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center group-hover:bg-primary transition-colors duration-200">
                <svg className="w-4 h-4 text-zinc-400 group-hover:text-zinc-950 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
