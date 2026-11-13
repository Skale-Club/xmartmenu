/**
 * The thin brand-gradient line on top of a prominent dark card (the sign-in
 * popup), with a soft red glow under it: Xprout red fading to the light
 * red of the site's headline gradient. The parent must be positioned and clip
 * its overflow (rounded corners).
 */
export default function GradientTopLine({ glow = true }: { glow?: boolean }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-8 top-0 z-20 h-px bg-[linear-gradient(90deg,transparent,#F52323_38%,#FCA5A5_68%,transparent)]"
      />
      {glow ? (
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 z-0 h-24 w-48 -translate-x-1/2 rounded-full bg-[#F52323]/10 blur-3xl" />
      ) : null}
    </>
  )
}
