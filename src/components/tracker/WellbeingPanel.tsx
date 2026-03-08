import { ExternalLink, Heart, HelpCircle, Phone, PoundSterling, ShieldCheck } from "lucide-react"

const SECTIONS = [
  {
    title: "Gambling Support",
    icon: ShieldCheck,
    description: "Free, confidential help if gambling is causing you stress.",
    links: [
      {
        name: "GamCare",
        url: "https://www.gamcare.org.uk",
        detail: "Free advice, support and counselling for problem gamblers. Helpline: 0808 8020 133",
      },
      {
        name: "Gamblers Anonymous",
        url: "https://www.gamblersanonymous.org.uk",
        detail: "Peer support meetings across the UK and online.",
      },
      {
        name: "BeGambleAware",
        url: "https://www.begambleaware.org",
        detail: "Information, advice, and free treatment referrals. Helpline: 0808 8020 133",
      },
      {
        name: "National Gambling Helpline",
        url: "https://www.gamcare.org.uk/get-support/talk-to-us-now/",
        detail: "24/7 live chat and phone support.",
      },
    ],
  },
  {
    title: "Mental Health",
    icon: Heart,
    description: "If you're struggling, these organisations are here to listen.",
    links: [
      {
        name: "Samaritans",
        url: "https://www.samaritans.org",
        detail: "Free 24/7 listening service. Call 116 123 (free from any phone).",
      },
      {
        name: "Mind",
        url: "https://www.mind.org.uk",
        detail: "Mental health information, support, and local services. Infoline: 0300 123 3393",
      },
      {
        name: "CALM",
        url: "https://www.thecalmzone.net",
        detail: "Campaign Against Living Miserably. Helpline for men: 0800 58 58 58 (5pm\u2013midnight).",
      },
      {
        name: "NHS Mental Health Services",
        url: "https://www.nhs.uk/mental-health/",
        detail: "Self-referral to talking therapies and local crisis support.",
      },
    ],
  },
  {
    title: "Financial Support",
    icon: PoundSterling,
    description: "Free, impartial advice if money worries are getting on top of you.",
    links: [
      {
        name: "StepChange",
        url: "https://www.stepchange.org",
        detail: "Free debt advice and solutions. Call 0800 138 1111.",
      },
      {
        name: "Citizens Advice",
        url: "https://www.citizensadvice.org.uk/debt-and-money/",
        detail: "Help with budgeting, debt, and benefits.",
      },
      {
        name: "MoneyHelper",
        url: "https://www.moneyhelper.org.uk",
        detail: "Government-backed money and pensions guidance.",
      },
    ],
  },
  {
    title: "Horse Welfare",
    icon: HelpCircle,
    description: "Racing depends on animal welfare. These charities support retired and injured racehorses.",
    links: [
      {
        name: "Retraining of Racehorses (RoR)",
        url: "https://www.ror.org.uk",
        detail: "Official charity for the welfare of retired racehorses.",
      },
      {
        name: "World Horse Welfare",
        url: "https://www.worldhorsewelfare.org",
        detail: "International charity working to improve horses' lives.",
      },
      {
        name: "RSPCA",
        url: "https://www.rspca.org.uk",
        detail: "Report concerns about any animal's welfare.",
      },
    ],
  },
] as const

export function WellbeingPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold">Wellbeing & Support</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Betting should be fun. If it ever stops feeling that way, help is available.
        </p>
      </div>

      {/* Crisis banner */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
        <Phone className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="text-sm">
          <div className="font-semibold">Need to talk now?</div>
          <div className="mt-0.5 text-muted-foreground">
            Call <span className="font-medium text-foreground">Samaritans free on 116 123</span> (24/7)
            or <span className="font-medium text-foreground">GamCare on 0808 8020 133</span>
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-3">
          <div className="flex items-center gap-2">
            <section.icon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{section.title}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{section.description}</p>

          <div className="grid gap-2 sm:grid-cols-2">
            {section.links.map((link) => (
              <a
                key={link.name}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-1 rounded-xl border border-border/50 bg-card/60 px-4 py-3 transition-colors hover:border-border hover:bg-muted/20"
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {link.name}
                  <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  {link.detail}
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
