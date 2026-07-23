import { ArrowUpRight } from "lucide-react";
import { FluentWidget, type FluentWidgetConfig } from "@fluent/react";
import { showcaseApps } from "./catalog";

const widgetConfig = {
  network: "testnet",
  appName: "Fluent SDK Apps",
  source: "sdk_showcase",
  campaign: "sdk-app-directory",
} satisfies FluentWidgetConfig;

export default function App() {
  return (
    <FluentWidget
      config={widgetConfig}
      mode="home"
      showDebugPayload={false}
      renderHome={() => (
        <main>
          <header className="showcase-header">
            <img src="/fluent-assets/fluent-logo.svg" alt="Fluent" />
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
              <span>{showcaseApps.length} deployments</span>
            </div>

            <div className="app-grid">
              {showcaseApps.map((app) => {
                const Icon = app.icon;
                return (
                  <article className={`app-card app-card-${app.accent}`} key={app.id}>
                    <div className="app-visual" aria-hidden="true">
                      <Icon size={38} strokeWidth={1.6} />
                      <span>{app.meta}</span>
                    </div>
                    <div className="app-card-body">
                      <p className="app-category">{app.category}</p>
                      <h3>{app.name}</h3>
                      <p>{app.description}</p>
                      <a href={app.href}>
                        {app.action}
                        <ArrowUpRight size={18} aria-hidden="true" />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </main>
      )}
    />
  );
}
