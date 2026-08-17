import { ArrowUpRight } from "lucide-react";
import { FLUENT_CONNECT_DEFAULT_ASSETS } from "@fluent.xyz/connect";
import { showcaseApps } from "./catalog";

export default function App() {
  return (
    <main>
      <header className="showcase-header">
        <img src={FLUENT_CONNECT_DEFAULT_ASSETS.fluentLogo} alt="Fluent" />
        <div>
          <p className="eyebrow">Connect SDK preview</p>
          <h1>Fluent SDK apps</h1>
          <p className="intro">
            Focused examples of smart accounts, permissioned sessions, batched calls,
            and ERC-20 gas payments on Fluent Testnet.
          </p>
        </div>
      </header>

      <section className="app-directory" aria-labelledby="app-directory-title">
        <div className="directory-heading">
          <div>
            <p className="eyebrow">Live examples</p>
            <h2 id="app-directory-title">Choose an app</h2>
          </div>
          <span>{showcaseApps.filter((app) => !app.disabled).length} available</span>
        </div>

        <div className="app-grid">
          {showcaseApps.map((app) => {
            const Icon = app.icon;
            const className = [
              "app-card",
              `app-card-${app.accent}`,
              app.disabled ? "app-card-disabled" : "",
            ].filter(Boolean).join(" ");

            return (
              <article
                aria-disabled={app.disabled || undefined}
                className={className}
                key={app.id}
                tabIndex={app.disabled ? 0 : undefined}
              >
                <div className="app-visual" aria-hidden="true">
                  <Icon size={38} strokeWidth={1.6} />
                  <span>{app.meta}</span>
                </div>
                <div className="app-card-body">
                  <p className="app-category">{app.category}</p>
                  <h3>{app.name}</h3>
                  <p>{app.description}</p>
                  {app.disabled ? (
                    <>
                      <span className="app-disabled-action">Under development</span>
                      <span className="app-disabled-tooltip" role="status">
                        Under development — check back soon
                      </span>
                    </>
                  ) : (
                      <a href={app.href}>
                        {app.action}
                        <ArrowUpRight size={18} aria-hidden="true" />
                      </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
