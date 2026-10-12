const pages = [
  { href: "/", label: "Wallet menu" },
  { href: "/customize", label: "Customize" },
  { href: "/design-system", label: "Design system" },
];

/** The preview app's three pages. Plain links: the app has no router. */
export function PreviewNav() {
  const current = window.location.pathname;
  return (
    <nav aria-label="Preview pages" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {pages.map((page) => {
        const active = current === page.href;
        return (
          <a
            key={page.href}
            href={page.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "font-medium text-white"
                : "text-white/40 transition-colors hover:text-white/80"
            }
          >
            {page.label}
          </a>
        );
      })}
    </nav>
  );
}
