import DemoBanner from '@/components/demo/DemoBanner'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <DemoBanner />
    </>
  )
}
