export function getAnonymousId(): string {
  const storageKey = "fluent_demo_visitor_id";
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;

  const next = crypto.randomUUID?.() ?? `visitor_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(storageKey, next);
  return next;
}
