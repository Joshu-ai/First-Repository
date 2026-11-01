import { buildLog, faq, nav, plans, process, services, site, work } from "@/content";

export default function Home() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <div className="wrap nav-inner">
          <a href="#top" className="logo" aria-label={`${site.name} home`}>
            <LogoMark />
            {site.name}
          </a>
          <nav aria-label="Main">
            <ul className="nav-links">
              {nav.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <a className="btn btn-small btn-primary" href="#contact">
            Book a call
          </a>
        </div>
      </header>

      <main id="main">
        <section id="top" className="hero">
          <div className="grid-bg" aria-hidden="true" />
          <div className="wrap hero-inner">
            <h1 className="hero-title">
              <span>From brief</span>
              <span>to production</span>
              <span>in three weeks.</span>
            </h1>
            <p className="lede">{site.description}</p>
            <div className="actions">
              <a className="btn btn-primary" href="#contact">
                Book a free call
              </a>
              <a className="btn btn-ghost" href="#pricing">
                See pricing
              </a>
            </div>
            <BuildLog />
          </div>
        </section>

        <section id="services" className="section">
          <div className="wrap">
            <SectionHead
              title="What I build"
              intro="One developer, start to finish. You talk to the person writing the code."
            />
            <ul className="tiles tiles-3">
              {services.map((s) => (
                <li key={s.title} className="tile">
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="process" className="section">
          <div className="wrap">
            <SectionHead
              title="How a project runs"
              intro="Four steps, each with something you can see and approve before the next one starts."
            />
            <ol className="steps">
              {process.map((step, i) => (
                <li key={step.title} className="step">
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="work" className="section">
          <div className="wrap">
            <SectionHead
              title="Recent work"
              intro="Sample projects shown below. Ask on a call for live links and references."
            />
            <ul className="work">
              {work.map((p) => (
                <li key={p.name} className="work-item">
                  <Preview hue={p.hue} name={p.name} />
                  <div className="work-meta">
                    <h3>{p.name}</h3>
                    <span className="work-kind">{p.kind}</span>
                  </div>
                  <p>{p.result}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="section">
          <div className="wrap">
            <SectionHead
              title="Fixed prices, written scope"
              intro="Every project starts with a written plan. The price on the plan is the price you pay."
            />
            <ul className="tiles tiles-3 plans">
              {plans.map((plan) => (
                <li key={plan.name} className={`tile plan${plan.featured ? " plan-featured" : ""}`}>
                  <div className="plan-head">
                    <h3>{plan.name}</h3>
                    {plan.featured && <span className="badge">Most chosen</span>}
                  </div>
                  <p className="price">
                    {plan.price} <span>{plan.note}</span>
                  </p>
                  <p>{plan.summary}</p>
                  <ul className="checks">
                    {plan.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <a
                    className={`btn ${plan.featured ? "btn-primary" : "btn-ghost"}`}
                    href="#contact"
                  >
                    {plan.cta}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="wrap faq-wrap">
            <SectionHead title="Questions" intro="Something else on your mind? Ask on the call." />
            <div className="faq">
              {faq.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="section cta">
          <div className="wrap cta-inner">
            <h2>Tell me what you want to build.</h2>
            <p className="lede">
              Send a few lines about your project. You will get a reply within one business day
              with times for a free 30-minute call.
            </p>
            <div className="actions">
              <a
                className="btn btn-primary"
                href={`mailto:${site.email}?subject=${encodeURIComponent("New website project")}`}
              >
                Email {site.email}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a href="#top" className="logo">
            <LogoMark />
            {site.name}
          </a>
          <ul className="footer-links">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
          <p className="fine">
            © {site.name}. Built with Next.js.
          </p>
        </div>
      </footer>
    </>
  );
}

function SectionHead({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <p>{intro}</p>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M13 6v7.5a3 3 0 0 1-6 0" fill="none" stroke="var(--signal)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function BuildLog() {
  return (
    <figure className="log" aria-label="Example project timeline">
      <div className="log-bar">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="log-title">your-new-site</span>
      </div>
      <ol className="log-body">
        {buildLog.map((line, i) => (
          <li key={line.cmd} style={{ "--i": i } as React.CSSProperties}>
            <span className="log-cmd">
              <span className="prompt" aria-hidden="true">$</span> {line.cmd}
            </span>
            <span className="log-out">
              <span className="ok" aria-hidden="true">✓</span> {line.out}
            </span>
            <span className="log-when">{line.when}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Preview({ hue, name }: { hue: number; name: string }) {
  return (
    <div className="preview" style={{ "--h": hue } as React.CSSProperties} aria-hidden="true">
      <div className="preview-bar">
        <i />
        <i />
        <i />
      </div>
      <div className="preview-body">
        <span className="preview-title">{name}</span>
        <span className="preview-line" />
        <span className="preview-line short" />
        <span className="preview-blocks">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
