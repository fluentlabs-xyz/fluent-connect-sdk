import type { ReactNode } from "react";

/**
 * Holds a `position: fixed` overlay inside a card: a transformed ancestor is the
 * containing block for fixed descendants, so the overlay fills this box instead
 * of the viewport. Only works for overlays rendered in place — anything that
 * portals leaves the frame, which is why the review dialogs shown through it sit
 * outside `FluentPortalContainerProvider`.
 */
export function OverlayFrame({ children, className = "h-[640px]" }: { children: ReactNode; className?: string }) {
  return <div className={`relative isolate overflow-hidden [transform:translateZ(0)] ${className}`}>{children}</div>;
}
