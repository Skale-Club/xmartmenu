'use client'

import { useId, useState, type ReactNode } from 'react'
import { LazyMotion, domAnimation } from 'framer-motion'
import { Check, Minus, ArrowRight } from 'lucide-react'
import { Nav, Footer } from '@/components/marketing/MarketingChrome'
import {
  ADDONS, CHANGES_PER_MONTH, LAUNCH_ENDS, LAUNCH_SLOTS, MAX_ITEMS, MAX_LANGUAGES, MIN_MONTHS, NFC_NOTE, PAYMENT_SPLIT,
  PLANS, PRICING_CTA_HREF, PROJECTS, THREE_D_TIER_10, THREE_D_TIER_20, YEARLY_FREE_MONTHS,
  estimateProject, formatUsd, type EstimateMode, type PlanKey,
} from '@/lib/marketing/pricing'

const card = 'rounded-[1.25rem] border border-white/25 bg-white/10 backdrop-blur-sm'
const focus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950'
const ctaBtn = `inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-bold text-primary-foreground transition-all hover:brightness-110 ${focus}`

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-widest text-primary">{children}</p>
}

function SectionHead({ eyebrow, title, lead, id }: { eyebrow: string; title: string; lead?: string; id: string }) {
  return (
    <div className="mb-8 grid gap-2">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      {lead && <p className="max-w-2xl text-zinc-400">{lead}</p>}
    </div>
  )
}

/** Launch price big, list price crossed out next to it. */
function Price({ launch, list, note }: { launch: number; list: number; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <strong className="text-4xl font-extrabold tabular-nums text-white">{formatUsd(launch)}</strong>
      <s className="text-base tabular-nums text-zinc-500" aria-label={`regular price ${formatUsd(list)}`}>{formatUsd(list)}</s>
      {note && <span className="w-full text-sm text-zinc-400">{note}</span>}
    </div>
  )
}

function Inc({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 text-sm text-zinc-300">
      {items.map((t) => (
        <li key={t} className="grid grid-cols-[18px_1fr] gap-2">
          <Check className="mt-0.5 h-4 w-4 text-emerald-400" aria-hidden="true" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

function BuildSection() {
  const we = PROJECTS.we
  const td = PROJECTS.threeD
  return (
    <section aria-labelledby="build-title" className="mx-auto w-full max-w-[1320px] px-4 py-12 sm:px-8">
      <SectionHead id="build-title" eyebrow="Step one · one-time" title="Build your menu" lead="A closed price for the project. The first month is included." />
      <div className="grid gap-4 md:grid-cols-3">
        <article className={`${card} grid content-start gap-4 p-6`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">You add the items</p>
          <Price launch={PROJECTS.diy.launch} list={PROJECTS.diy.list} note="one-time" />
          <Inc items={[
            'Menu website with your logo and colours',
            'Categories, 2 languages, hours, contacts and map',
            'SEO pages and QR codes for your tables',
            '30-minute training by video call',
            'You add dishes and photos in your own panel',
          ]} />
          <p className="border-t border-white/10 pt-3 text-sm text-zinc-400">Unlimited items, added by you.</p>
        </article>

        <article className={`${card} grid content-start gap-4 border-primary p-6 ring-1 ring-primary`}>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">Most popular · we do everything</p>
          <Price launch={we.launch} list={we.list} note={`one-time · up to ${we.includedItems} items`} />
          <Inc items={[
            'Everything in "You add the items"',
            `We add your first ${we.includedItems} items for you`,
            'Your phone photos touched up and framed',
            'A photo guide so every dish looks its best',
            'Ready in about a week',
          ]} />
          <p className="border-t border-white/10 pt-3 text-sm text-zinc-400">
            Extra item: <strong className="tabular-nums text-white">+{formatUsd(we.extraItem.launch)}</strong>{' '}
            <s className="text-zinc-500">{formatUsd(we.extraItem.list)}</s>
          </p>
        </article>

        <article className={`${card} grid content-start gap-4 p-6`}>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Menu with 3D · we do everything</p>
          <Price launch={td.launch} list={td.list} note={`one-time · up to ${td.includedItems} items, all as 3D dishes`} />
          <Inc items={[
            'Everything in "We do everything"',
            `All ${td.includedItems} dishes as 3D dishes`,
            'Guests see the dish in 3D on their table, at real size',
            'Works on iPhone and Android, and in 3D on computers',
            'Made from your own dish photos',
          ]} />
          <p className="border-t border-white/10 pt-3 text-sm text-zinc-400">
            Extra item with 3D: <strong className="tabular-nums text-white">+{formatUsd(td.extraItemWith3D.launch)}</strong>{' '}
            <s className="text-zinc-500">{formatUsd(td.extraItemWith3D.list)}</s>. Without 3D:{' '}
            <strong className="tabular-nums text-white">+{formatUsd(td.extraItemWithout3D)}</strong>.
          </p>
        </article>
      </div>

      <div className={`${card} mt-6 grid items-center gap-6 p-6 md:grid-cols-[1.3fr_1fr]`}>
        <div className="grid gap-2">
          <Eyebrow>Add 3D to any menu</Eyebrow>
          <h3 className="text-xl font-bold text-white">Start with your best dishes</h3>
          <p className="text-sm text-zinc-400">
            Each dish is scaled to the real plate: a 12-inch main, a 9-inch starter, an 8-inch dessert; drinks by glass height. You approve every dish before it goes live.
          </p>
          <p className="text-sm text-zinc-500">{NFC_NOTE}</p>
        </div>
        <div className="grid gap-2">
          <div className="flex justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3 font-semibold text-white">
            <span>1 to {THREE_D_TIER_10 - 1} dishes</span><span className="tabular-nums">{formatUsd(ADDONS.threeDDish.launch)} each</span>
          </div>
          <div className="flex justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3 font-semibold text-white">
            <span>{THREE_D_TIER_10} dishes</span><span className="tabular-nums">{formatUsd(ADDONS.threeDDish.from10Total)}</span>
          </div>
          <div className="flex justify-between gap-3 rounded-xl bg-zinc-950/60 px-4 py-3 font-semibold text-white">
            <span>{THREE_D_TIER_20} dishes or more</span><span className="tabular-nums">{formatUsd(ADDONS.threeDDish.from20Each)} each</span>
          </div>
        </div>
      </div>
    </section>
  )
}

type Cell = boolean | string
type Row = { group: string } | { label: string; menu: Cell; waiter: Cell; payments: Cell }

const ROWS: Row[] = [
  { group: 'Your menu website' },
  { label: 'Menu website on your domain or ours', menu: true, waiter: true, payments: true },
  { label: 'Photos, list and feed views', menu: true, waiter: true, payments: true },
  { label: '2 languages, hours, contacts, map', menu: true, waiter: true, payments: true },
  { label: '3D dishes viewer (for the dishes you bought in 3D)', menu: true, waiter: true, payments: true },
  { label: 'Visits and dish analytics', menu: true, waiter: true, payments: true },
  { label: 'Changes done by our team', menu: `${CHANGES_PER_MONTH} / month`, waiter: `${CHANGES_PER_MONTH} / month`, payments: `${CHANGES_PER_MONTH} / month` },
  { group: 'At the table' },
  { label: 'Guests order from their table', menu: false, waiter: true, payments: true },
  { label: 'Call the waiter from the phone', menu: false, waiter: true, payments: true },
  { label: 'Orders on the kitchen display', menu: false, waiter: true, payments: true },
  { label: 'One QR code per table', menu: false, waiter: true, payments: true },
  { group: 'Payments' },
  { label: 'Guests pay in the menu', menu: false, waiter: 'Paid the usual way', payments: true },
  { label: 'Card, Apple Pay and Google Pay', menu: false, waiter: false, payments: true },
  { label: 'Online pickup orders, paid ahead', menu: false, waiter: false, payments: true },
  { label: 'Money goes straight to your Stripe account', menu: false, waiter: false, payments: true },
  { label: 'Fee per payment through XmartMenu', menu: false, waiter: false, payments: `${PLANS.payments.paymentFeePercent}%` },
]

function CellView({ v, hl }: { v: Cell; hl?: boolean }) {
  const cls = `px-4 py-3 text-center border-b border-white/10 ${hl ? 'bg-primary/10' : ''}`
  if (v === true) return <td className={cls}><Check className="mx-auto h-5 w-5 text-emerald-400" aria-label="Included" /></td>
  if (v === false) return <td className={cls}><Minus className="mx-auto h-5 w-5 text-zinc-600" aria-label="Not included" /></td>
  return <td className={`${cls} text-sm font-semibold tabular-nums text-zinc-200`}>{v}</td>
}

function PlansSection() {
  const [yearly, setYearly] = useState(false)
  const keys: PlanKey[] = ['menu', 'waiter', 'payments']
  const names: Record<PlanKey, string> = { menu: 'Menu', waiter: 'Waiter', payments: 'Payments' }
  const seg = (on: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${focus} ${on ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'}`
  return (
    <section aria-labelledby="monthly-title" className="mx-auto w-full max-w-[1320px] px-4 py-12 sm:px-8">
      <SectionHead id="monthly-title" eyebrow="Step two · every month" title="Choose how guests use it" lead="Hosting, software, changes and support. Start with the menu and move up when you are ready." />
      <div role="group" aria-label="Billing period" className="mb-5 inline-flex rounded-full border border-white/20 bg-white/5 p-1">
        <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)} className={seg(!yearly)}>Monthly</button>
        <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)} className={seg(yearly)}>Yearly · {YEARLY_FREE_MONTHS} months free</button>
      </div>
      <div className={`${card} overflow-x-auto`} tabIndex={0} role="region" aria-label="Plan comparison, scrollable">
        <table className="w-full min-w-[640px] border-collapse text-sm text-zinc-300">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-4 text-left align-top text-sm font-medium text-zinc-400">What is included</th>
              {keys.map((k) => (
                <th key={k} scope="col" className={`px-4 py-4 text-center align-top ${k === 'waiter' ? 'bg-primary/10' : ''}`}>
                  <span className="block text-lg font-extrabold text-white">{names[k]}</span>
                  <span className="mt-1 block text-3xl font-extrabold tabular-nums text-white">{formatUsd(yearly ? PLANS[k].yearly : PLANS[k].monthly)}</span>
                  <span className="block text-xs font-medium text-zinc-400">{yearly ? 'per year' : 'per month'}</span>
                  {PLANS[k].paymentFeePercent ? <span className="block text-xs font-medium text-zinc-400">+ {PLANS[k].paymentFeePercent}% per payment</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) =>
              'group' in r ? (
                <tr key={r.group}><th scope="colgroup" colSpan={4} className="bg-zinc-950/60 px-4 py-2 text-left text-xs font-bold uppercase tracking-wider text-zinc-400">{r.group}</th></tr>
              ) : (
                <tr key={r.label}>
                  <th scope="row" className="border-b border-white/10 px-4 py-3 text-left font-normal">{r.label}</th>
                  <CellView v={r.menu} />
                  <CellView v={r.waiter} hl />
                  <CellView v={r.payments} />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-zinc-400">
        The {PLANS.payments.paymentFeePercent}% applies only when the guest pays through XmartMenu. Stripe&apos;s own processing fee is charged by Stripe.
        {' '}{MIN_MONTHS}-month minimum, then month to month.
      </p>
    </section>
  )
}

function Pair({ launch, list, unit }: { launch: ReactNode; list?: ReactNode; unit?: string }) {
  return (
    <span className="tabular-nums">
      <strong className="text-white">{launch}</strong>{unit ? <span className="text-zinc-400"> {unit}</span> : null}
      {list ? <s className="ml-2 text-zinc-500">{list}</s> : null}
    </span>
  )
}

function AddonsSection() {
  const a = ADDONS
  const d = a.threeDDish
  const rows: Array<{ name: string; detail?: string; price: ReactNode }> = [
    { name: 'Extra language', detail: 'per language', price: <Pair launch={formatUsd(a.extraLanguage.launch)} list={formatUsd(a.extraLanguage.list)} /> },
    { name: 'Extra item added by us', price: <Pair launch={formatUsd(a.extraItem.launch)} list={formatUsd(a.extraItem.list)} /> },
    { name: 'Photo touch-up', detail: 'for restaurants that add their own items', price: <Pair launch={formatUsd(a.photoTouchUp.launch)} list={formatUsd(a.photoTouchUp.list)} unit="per photo" /> },
    {
      name: '3D dish',
      detail: `${formatUsd(d.from10Each)} each from ${THREE_D_TIER_10} dishes (${THREE_D_TIER_10} = ${formatUsd(d.from10Total)}); ${formatUsd(d.from20Each)} each from ${THREE_D_TIER_20} dishes`,
      price: <Pair launch={formatUsd(d.launch)} list={formatUsd(d.list)} unit="each" />,
    },
    { name: '3D drink in a glass', price: <Pair launch={formatUsd(a.threeDDrink.launch)} list={formatUsd(a.threeDDrink.list)} /> },
    { name: 'Redo a 3D dish after a plating change', price: <Pair launch={`${a.redoThreeDPercent}%`} unit="of its price" /> },
    { name: `Extra change request beyond ${CHANGES_PER_MONTH} per month`, price: <Pair launch={formatUsd(a.extraChange.launch)} list={formatUsd(a.extraChange.list)} /> },
    { name: 'AI chat that answers guests', detail: 'text and voice', price: <Pair launch={formatUsd(a.aiChat.monthly)} unit="/ month" /> },
    { name: 'Growth', detail: 'AI chat + monthly blog/SEO content + unlimited languages', price: <Pair launch={formatUsd(a.growth.monthly)} list={formatUsd(a.growth.listMonthly)} unit="/ month" /> },
    { name: 'Extra location', price: <Pair launch={formatUsd(a.extraLocation.monthly)} list={formatUsd(a.extraLocation.listMonthly)} unit="/ month" /> },
  ]
  return (
    <section aria-labelledby="addons-title" className="mx-auto w-full max-w-[1320px] px-4 py-12 sm:px-8">
      <SectionHead id="addons-title" eyebrow="Add-ons" title="Pay only for what you add" />
      <div className={`${card} overflow-x-auto`} tabIndex={0} role="region" aria-label="Add-ons price list, scrollable">
        <table className="w-full min-w-[560px] border-collapse text-sm text-zinc-300">
          <caption className="sr-only">Add-ons with launch price and regular price crossed out</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-zinc-400">
              <th scope="col" className="px-4 py-3 font-bold">Add-on</th>
              <th scope="col" className="px-4 py-3 font-bold">Launch price <span className="font-normal normal-case">(regular price crossed out)</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-white/10">
                <th scope="row" className="px-4 py-3 text-left font-semibold text-white">
                  {r.name}
                  {r.detail && <span className="block text-xs font-normal text-zinc-400">{r.detail}</span>}
                </th>
                <td className="px-4 py-3">{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Estimator() {
  const uid = useId()
  const [mode, setMode] = useState<EstimateMode>('we')
  const [items, setItems] = useState('40')
  const [threeD, setThreeD] = useState('10')
  const [langs, setLangs] = useState('0')
  const [photos, setPhotos] = useState('0')
  const [plan, setPlan] = useState<PlanKey>('waiter')

  const n = (v: string) => parseInt(v, 10) || 0
  const e = estimateProject({ mode, items: n(items), threeDDishes: n(threeD), extraLanguages: n(langs), photos: n(photos), plan })

  const field = `w-full rounded-xl border border-white/20 bg-zinc-950/60 px-3 py-2.5 text-base text-white ${focus}`
  const label = 'grid gap-1.5 text-sm font-semibold text-zinc-200'
  const hint = 'text-xs font-normal text-zinc-400'
  const line = (name: string, v: number, extra?: string) => (
    <div className="flex justify-between gap-3"><span>{name}{extra ? ` (${extra})` : ''}</span><span className="tabular-nums">{formatUsd(v)}</span></div>
  )

  return (
    <section aria-labelledby="estimate-title" className="mx-auto w-full max-w-[1320px] px-4 py-12 sm:px-8">
      <SectionHead id="estimate-title" eyebrow="Estimate" title="What your restaurant would pay" />
      <div className="grid gap-4 md:grid-cols-2">
        <form className={`${card} grid content-start gap-4 p-6`} onSubmit={(ev) => ev.preventDefault()} noValidate>
          <label htmlFor={`${uid}-mode`} className={label}>Who adds the items?
            <select id={`${uid}-mode`} className={field} value={mode} onChange={(ev) => setMode(ev.target.value as EstimateMode)}>
              <option value="we">We do everything</option>
              <option value="diy">You add the items</option>
            </select>
          </label>
          <label htmlFor={`${uid}-items`} className={label}>Items on the menu
            <input id={`${uid}-items`} className={field} type="number" inputMode="numeric" min={0} max={MAX_ITEMS} value={items} onChange={(ev) => setItems(ev.target.value)} />
            <span className={hint}>{mode === 'diy' ? 'You add them yourself, no extra cost.' : `${PROJECTS.we.includedItems} included, then ${formatUsd(PROJECTS.we.extraItem.launch)} each.`}</span>
          </label>
          <label htmlFor={`${uid}-3d`} className={label}>Dishes in 3D
            <input id={`${uid}-3d`} className={field} type="number" inputMode="numeric" min={0} max={MAX_ITEMS} value={threeD} onChange={(ev) => setThreeD(ev.target.value)} />
            <span className={hint}>{formatUsd(ADDONS.threeDDish.launch)} each, {THREE_D_TIER_10} for {formatUsd(ADDONS.threeDDish.from10Total)}, {formatUsd(ADDONS.threeDDish.from20Each)} each from {THREE_D_TIER_20}.</span>
          </label>
          <label htmlFor={`${uid}-lang`} className={label}>Extra languages
            <input id={`${uid}-lang`} className={field} type="number" inputMode="numeric" min={0} max={MAX_LANGUAGES} value={langs} onChange={(ev) => setLangs(ev.target.value)} />
            <span className={hint}>{formatUsd(ADDONS.extraLanguage.launch)} per language.</span>
          </label>
          {mode === 'diy' && (
            <label htmlFor={`${uid}-photos`} className={label}>Photos you want touched up
              <input id={`${uid}-photos`} className={field} type="number" inputMode="numeric" min={0} value={photos} onChange={(ev) => setPhotos(ev.target.value)} />
              <span className={hint}>{formatUsd(ADDONS.photoTouchUp.launch)} per photo.</span>
            </label>
          )}
          <label htmlFor={`${uid}-plan`} className={label}>Monthly version
            <select id={`${uid}-plan`} className={field} value={plan} onChange={(ev) => setPlan(ev.target.value as PlanKey)}>
              <option value="menu">Menu · {formatUsd(PLANS.menu.monthly)}</option>
              <option value="waiter">Waiter · {formatUsd(PLANS.waiter.monthly)}</option>
              <option value="payments">Payments · {formatUsd(PLANS.payments.monthly)} + {PLANS.payments.paymentFeePercent}%</option>
            </select>
          </label>
        </form>

        <div className={`${card} grid content-start gap-4 p-6`} aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Your estimate</p>
          <div className="grid gap-2 text-sm text-zinc-300">
            {line('Menu build', e.base, mode === 'diy' ? 'you add the items' : `${PROJECTS.we.includedItems} items included`)}
            {line('Extra items', e.extraItems)}
            {line('3D dishes', e.threeD, e.threeDCount ? String(e.threeDCount) : undefined)}
            {line('Extra languages', e.languages)}
            {mode === 'diy' && line('Photo touch-ups', e.photoTouchUps)}
            <div className="flex justify-between gap-3 border-t border-white/10 pt-3 text-base font-bold text-white"><span>Project, one-time</span><span className="tabular-nums">{formatUsd(e.project)}</span></div>
          </div>
          <p className="text-4xl font-extrabold tabular-nums text-white">{formatUsd(e.project)}</p>
          <p className="text-sm text-zinc-400">
            Then {formatUsd(e.monthly)} / month from month two{e.paymentFeePercent ? `, plus ${e.paymentFeePercent}% of payments made through XmartMenu` : ''}.
          </p>
          <p className="text-sm text-zinc-400">First year: <strong className="tabular-nums text-white">{formatUsd(e.firstYear)}</strong> (first month included in the project).</p>
          <a href={PRICING_CTA_HREF} className={`${ctaBtn} w-full sm:w-fit`}>Talk to us <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { t: 'Send your menu', d: 'Your current menu and phone photos of your dishes. Our guide shows how to shoot them.' },
  { t: 'We build it', d: 'Your menu website, translations, QR codes and 3D dishes, in about a week.' },
  { t: 'You approve', d: 'We walk you through it on a video call and you sign off on every dish.' },
  { t: 'We keep it fresh', d: 'New dishes, prices and specials: send them, we update them.' },
]

function ProcessSection() {
  return (
    <section aria-labelledby="how-title" className="mx-auto w-full max-w-[1320px] px-4 py-12 sm:px-8">
      <SectionHead id="how-title" eyebrow="From anywhere" title="How we build it" />
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.t} className="grid content-start gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-sm font-extrabold text-zinc-950" aria-hidden="true">{i + 1}</span>
            <h3 className="text-lg font-bold text-white">{s.t}</h3>
            <p className="text-sm text-zinc-400">{s.d}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function PricingClient() {
  return (
    <LazyMotion features={domAnimation} strict>
      <div className="min-h-screen bg-zinc-950 text-zinc-50 selection:bg-primary/30">
        <Nav startHref={PRICING_CTA_HREF} />
        <main className="pt-16">
          <header className="relative overflow-hidden px-4 pb-8 pt-16 sm:px-8">
            <div className="pointer-events-none absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
            <div className="relative mx-auto grid max-w-[1320px] gap-5">
              <span className="inline-flex w-fit items-center rounded-full border border-primary/40 bg-primary/20 px-3 py-1 text-sm font-semibold text-white">
                Launch pricing for our first {LAUNCH_SLOTS} restaurants · USD
              </span>
              <h1 className="max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">
                Your restaurant&apos;s menu website, built for you.
              </h1>
              <p className="max-w-2xl text-lg text-zinc-300">
                A menu your guests open by scanning or tapping at the table: real photos, your languages, ordering, payments, and 3D dishes they can see on their table at real size before they order. We build it, you approve it, we keep it updated.
              </p>
              <a href={PRICING_CTA_HREF} className={`${ctaBtn} w-fit`}>Talk to us <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            </div>
          </header>
          <BuildSection />
          <PlansSection />
          <AddonsSection />
          <Estimator />
          <ProcessSection />
          <section className="mx-auto grid w-full max-w-[1320px] gap-3 px-4 pb-16 pt-4 text-sm text-zinc-400 sm:px-8" aria-label="Fine print">
            <p>Launch prices are valid for our first {LAUNCH_SLOTS} restaurants or until {LAUNCH_ENDS}, whichever comes first. Crossed-out prices are our regular prices.</p>
            <p>Project paid {PAYMENT_SPLIT.start}% to start and {PAYMENT_SPLIT.launch}% at launch. Monthly plans have a {MIN_MONTHS}-month minimum, then month to month. All prices in US dollars, before tax. {NFC_NOTE}</p>
            <a href={PRICING_CTA_HREF} className={`${ctaBtn} mt-2 w-fit`}>Talk to us <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
          </section>
        </main>
        <Footer />
      </div>
    </LazyMotion>
  )
}
