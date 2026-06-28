import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bot, Calculator, Check, HelpCircle, Send, Sparkles, Star,
} from 'lucide-react'
import ThemeToggle from '@/components/ThemeToggle'

type Billing = 'monthly' | 'yearly'

const plans = [
  {
    name: 'Starter',
    price: { monthly: 2999, yearly: 2399 },
    tag: 'For one sales desk',
    description: 'Launch WhatsApp batch follow-ups with a practical AI agent.',
    highlight: false,
    features: [
      '1 WhatsApp number',
      'Up to 5,000 AI-assisted contacts/month',
      'Knowledge base and agent setup',
      'Batch follow-ups and templates',
      'Human review queue',
      'Email support',
    ],
  },
  {
    name: 'Growth',
    price: { monthly: 6999, yearly: 5599 },
    tag: 'Most teams start here',
    description: 'For distributors that want AI follow-ups, CRM summaries, and priority review.',
    highlight: true,
    features: [
      '3 WhatsApp numbers',
      'Up to 25,000 AI-assisted contacts/month',
      'AI CRM and batch summaries',
      'Priority human review signals',
      'Multiple agents and knowledge sets',
      'Priority support',
    ],
  },
  {
    name: 'Scale',
    price: { monthly: 14999, yearly: 11999 },
    tag: 'For high-volume operations',
    description: 'More numbers, higher limits, and implementation help.',
    highlight: false,
    features: [
      '10 WhatsApp numbers',
      'Up to 100,000 AI-assisted contacts/month',
      'Advanced reporting exports',
      'Custom onboarding session',
      'Role and workspace planning',
      'Dedicated success channel',
    ],
  },
]

const usageExamples = [
  { messages: '1,000', platform: 'Starter', estimated: 'Approx. Rs 3.00 platform cost per assisted message/contact before Meta + AI pass-through.' },
  { messages: '10,000', platform: 'Growth', estimated: 'Approx. Rs 0.70 platform cost per assisted message/contact before Meta + AI pass-through.' },
  { messages: '50,000', platform: 'Scale', estimated: 'Approx. Rs 0.30 platform cost per assisted message/contact before Meta + AI pass-through.' },
]

const perMessageScale = [
  ['Starter', 'included up to 5,000', 'Rs 0.60 per extra assisted message'],
  ['Growth', 'included up to 25,000', 'Rs 0.25 per extra assisted message'],
  ['Scale', 'included up to 100,000', 'Rs 0.12 per extra assisted message'],
]

const planLimits = {
  Starter: { included: 5000, extra: 0.6 },
  Growth: { included: 25000, extra: 0.25 },
  Scale: { included: 100000, extra: 0.12 },
} as const

function recommendedPlanForVolume(volume: number) {
  if (volume <= planLimits.Starter.included) return plans[0]
  if (volume <= planLimits.Growth.included) return plans[1]
  return plans[2]
}

function formatINR(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/78 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/78">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-sm font-black text-white shadow-lg shadow-emerald-500/25">
            W
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-950 dark:text-white">WhatsyITC</span>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Pricing</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/" className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10 sm:inline-flex">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <ThemeToggle variant="pill" />
          <Link to="/login" className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
            Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero({ billing, setBilling }: { billing: Billing; setBilling: (value: Billing) => void }) {
  return (
    <section className="relative overflow-hidden px-5 py-16 lg:px-8 lg:py-20">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-48 -top-48 h-[34rem] w-[34rem] rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-400/12" />
        <div className="absolute -right-44 top-0 h-[30rem] w-[30rem] rounded-full bg-cyan-400/18 blur-3xl dark:bg-cyan-400/12" />
        <div className="grid-overlay absolute inset-0 opacity-70" />
      </div>
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300"
        >
          <Sparkles className="h-3.5 w-3.5" /> Transparent platform + usage pricing
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-5 text-display text-4xl text-slate-950 dark:text-white sm:text-6xl"
        >
          Simple pricing for WhatsApp AI sales follow-ups.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300"
        >
          Pay for the product your team uses: agents, knowledge, follow-ups, review queue, and dashboards. See the effective per-message software cost as your volume grows.
        </motion.p>
        <div className="mt-8 inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/8">
          {(['monthly', 'yearly'] as Billing[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setBilling(item)}
              className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                billing === item
                  ? 'bg-slate-950 text-white shadow dark:bg-white dark:text-slate-950'
                  : 'text-slate-600 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {item}
              {item === 'yearly' && <span className="ml-1 text-emerald-500">save 20%</span>}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function PricingCards({ billing }: { billing: Billing }) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-16 lg:px-8">
      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className={`relative rounded-[1.75rem] border p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-2xl ${
              plan.highlight
                ? 'border-emerald-300 bg-slate-950 text-white shadow-emerald-900/20 dark:border-emerald-400/35'
                : 'border-slate-200 bg-white text-slate-950 dark:border-white/10 dark:bg-slate-900/85 dark:text-white dark:shadow-slate-950/25'
            }`}
          >
            {plan.highlight && (
              <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                <Star className="h-3.5 w-3.5 fill-current" /> Best value
              </div>
            )}
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
              plan.highlight
                ? 'bg-white/10 text-emerald-200'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
            }`}>
              <Bot className="h-3.5 w-3.5" /> {plan.tag}
            </div>
            <h2 className="mt-5 text-2xl font-semibold">{plan.name}</h2>
            <p className={`mt-2 min-h-[3rem] text-sm leading-6 ${plan.highlight ? 'text-slate-300' : 'text-slate-600 dark:text-slate-300'}`}>
              {plan.description}
            </p>
            <div className="mt-7 flex items-end gap-2">
              <span className="text-4xl font-semibold tracking-tight">Rs {formatINR(plan.price[billing])}</span>
              <span className={`pb-1 text-sm ${plan.highlight ? 'text-slate-400' : 'text-slate-500'}`}>/month</span>
            </div>
            <div className={`mt-2 text-xs ${plan.highlight ? 'text-slate-400' : 'text-slate-500'}`}>
              billed {billing === 'yearly' ? 'annually' : 'monthly'}; provider charges not included
            </div>
            <Link
              to="/login"
              className={`mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold transition hover:-translate-y-0.5 ${
                plan.highlight
                  ? 'bg-white text-slate-950'
                  : 'bg-slate-950 text-white dark:bg-white dark:text-slate-950'
              }`}
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <div className={`mt-6 h-px ${plan.highlight ? 'bg-white/10' : 'bg-slate-200 dark:bg-white/10'}`} />
            <ul className="mt-6 space-y-3">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                    plan.highlight ? 'bg-emerald-400/15 text-emerald-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                  }`}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className={plan.highlight ? 'text-slate-200' : 'text-slate-700 dark:text-slate-200'}>{feature}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function UsageScale({ billing }: { billing: Billing }) {
  const growthPrice = plans[1].price[billing]
  const scalePrice = plans[2].price[billing]
  const customRows = [
    ['Platform fee', 'Your selected WhatsyITC plan: agent, dashboard, follow-ups, review queue, and CRM UI.'],
    ['Provider cost', 'Meta WhatsApp conversation/message charges are separate and depend on your WhatsApp Business account, country, and category.'],
    ['AI cost', 'LLM and embedding usage can be pass-through or bundled by your deployment. High-volume teams can cap or optimize this.'],
  ]

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-2xl shadow-slate-950/20 dark:border-white/10">
        <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="relative overflow-hidden p-8 lg:p-12">
            <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/25 blur-3xl" />
            <div className="absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-semibold text-emerald-200">
                <Send className="h-3.5 w-3.5" /> Usage scale
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-5xl">
                The more you send, the cheaper each assisted contact feels.
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                WhatsyITC pricing is a simple platform layer. At higher volume, the fixed monthly plan spreads across more conversations, so your effective software cost per assisted contact keeps dropping.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                  <div className="text-3xl font-semibold">Rs {formatINR(growthPrice)}</div>
                  <div className="mt-1 text-xs text-slate-400">Growth monthly platform</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                  <div className="text-3xl font-semibold">Rs {formatINR(scalePrice)}</div>
                  <div className="mt-1 text-xs text-slate-400">Scale monthly platform</div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 p-5 lg:border-l lg:border-t-0 lg:p-8">
            <div className="grid gap-3">
              {usageExamples.map((row, index) => (
                <motion.div
                  key={row.messages}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.06 }}
                  className="rounded-2xl border border-white/10 bg-white/8 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold">{row.messages} contacts/month</div>
                      <div className="mt-1 text-sm text-slate-400">{row.platform} fit</div>
                    </div>
                    <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">example</span>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-300">{row.estimated}</div>
                </motion.div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/8 p-4">
              <div className="font-semibold">After included monthly volume</div>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                {perMessageScale.map(([plan, included, extra]) => (
                  <div key={plan} className="grid grid-cols-[0.7fr_1fr_1.25fr] gap-3 border-b border-white/10 px-3 py-3 text-xs last:border-b-0 sm:text-sm">
                    <div className="font-semibold text-white">{plan}</div>
                    <div className="text-slate-400">{included}</div>
                    <div className="text-emerald-200">{extra}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs leading-5 text-slate-400">
                These are frontend pricing examples for the platform layer. Meta WhatsApp and AI provider costs stay separate.
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/8 p-4">
              <div className="font-semibold">What changes the final cost?</div>
              <div className="mt-3 space-y-3">
                {customRows.map(([label, text]) => (
                  <div key={label} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-200">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-white">{label}</span>
                      <span className="mt-0.5 block leading-6 text-slate-300">{text}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PricingCalculator({ billing }: { billing: Billing }) {
  const [volume, setVolume] = useState(10000)
  const plan = recommendedPlanForVolume(volume)
  const limit = planLimits[plan.name as keyof typeof planLimits]
  const baseMonthly = plan.price[billing]
  const overage = Math.max(0, volume - limit.included)
  const overageCost = Math.round(overage * limit.extra)
  const totalPlatform = baseMonthly + overageCost
  const effective = totalPlatform / Math.max(volume, 1)
  const percent = Math.min(100, Math.round((volume / 150000) * 100))

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900/85 lg:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(6,182,212,0.10),transparent_24%)] dark:bg-[radial-gradient(circle_at_10%_10%,rgba(16,185,129,0.20),transparent_28%),radial-gradient(circle_at_90%_20%,rgba(6,182,212,0.18),transparent_24%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Calculator className="h-3.5 w-3.5" /> Custom volume calculator
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              Slide your monthly message volume.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 dark:text-slate-300">
              Estimate the WhatsyITC platform layer for AI-assisted messages. Meta WhatsApp and AI provider costs stay separate.
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-slate-950/70">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">Monthly AI-assisted messages</div>
                <div className="mt-1 text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">{formatINR(volume)}</div>
              </div>
              <div className="rounded-2xl bg-emerald-600 px-4 py-3 text-white shadow-lg shadow-emerald-600/20">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">Recommended</div>
                <div className="mt-1 text-2xl font-semibold">{plan.name}</div>
              </div>
            </div>

            <div className="mt-6">
              <input
                type="range"
                min={500}
                max={150000}
                step={500}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="pricing-slider w-full"
                style={{ ['--progress' as string]: `${percent}%` }}
              />
              <div className="mt-2 flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>500</span>
                <span>50k</span>
                <span>150k+</span>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <PriceMetric label="Base plan" value={`Rs ${formatINR(baseMonthly)}`} />
              <PriceMetric label="Extra messages" value={`Rs ${formatINR(overageCost)}`} sub={overage ? `${formatINR(overage)} above included` : 'inside included volume'} />
              <PriceMetric label="Effective platform" value={`Rs ${effective.toFixed(2)}`} sub="per assisted message" accent />
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 dark:border-white/10 dark:bg-slate-900/85 dark:text-slate-300">
              Estimated platform total: <span className="font-semibold text-slate-950 dark:text-white">Rs {formatINR(totalPlatform)}/month</span>. This excludes Meta WhatsApp provider charges and AI provider pass-through.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function PriceMetric({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-500/10' : 'border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/85'}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

// function Faq() {
//   const items = [
//     ['Are WhatsApp charges included?', 'No. WhatsApp/Meta provider charges and LLM usage can be billed separately depending on your deployment. The prices here are for the WhatsyITC product layer.'],
//     ['Can we start with one number?', 'Yes. Starter is designed for a single WhatsApp number and one operating team.'],
//     ['How should I estimate per-message cost?', 'Divide your monthly platform plan by the number of AI-assisted messages or contacts you expect. Then add Meta WhatsApp and AI provider pass-through costs based on your setup.'],
//     ['Is this only frontend pricing?', 'Yes. This page is a frontend pricing presentation. It does not change billing, payment, or backend workflow behavior.'],
//   ]

//   return (
//     <section className="mx-auto max-w-4xl px-5 py-16 lg:px-8">
//       <div className="text-center">
//         <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-300">
//           <HelpCircle className="h-3.5 w-3.5" /> FAQ
//         </div>
//         <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">Clear billing answers</h2>
//       </div>
//       <div className="mt-8 space-y-3">
//         {items.map(([q, a]) => (
//           <div key={q} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/85">
//             <div className="font-semibold text-slate-950 dark:text-white">{q}</div>
//             <div className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{a}</div>
//           </div>
//         ))}
//       </div>
//     </section>
//   )
// }

export default function Pricing() {
  const [billing, setBilling] = useState<Billing>('monthly')

  useEffect(() => {
    document.title = 'Pricing - WhatsyITC'
  }, [])

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.10),transparent_42%),linear-gradient(to_bottom,#ffffff,#f8fafc_42%,#f1f5f9)] text-slate-950 dark:bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.13),transparent_42%),linear-gradient(to_bottom,#020617,#07111f_45%,#020617)] dark:text-white">
      <Header />
      <main>
        <Hero billing={billing} setBilling={setBilling} />
        <PricingCards billing={billing} />
        <PricingCalculator billing={billing} />
        <UsageScale billing={billing} />
        {/* <Faq /> */}
      </main>
      <footer className="border-t border-slate-200/70 py-10 dark:border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 text-sm text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} WhatsyITC. Pricing is illustrative and can be adjusted by your team.</span>
          <div className="flex gap-5">
            <Link to="/" className="hover:text-slate-950 dark:hover:text-white">Home</Link>
            <Link to="/login" className="hover:text-slate-950 dark:hover:text-white">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
