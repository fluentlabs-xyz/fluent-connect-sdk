import { useEffect, useState } from "react";

import { Icon } from "./Icon";
import { cn } from "../lib/utils";

export type AccountAvatarProps = {
  /** The signed-in user's X avatar, when Privy has one. Wins over `defaultLogoUrl`. */
  userLogoUrl?: string | null;
  /** Host-supplied stand-in for the Fluent mark — a URL or a data URI. */
  defaultLogoUrl?: string | null;
  className?: string;
};

/**
 * The 32px account tile's contents: X avatar, else the host's default logo, else
 * the Fluent mark. A logo that fails to load falls through to the next option
 * rather than leaving a broken image in the button.
 */
export function AccountAvatar({ userLogoUrl, defaultLogoUrl, className }: AccountAvatarProps) {
  const src = userLogoUrl || defaultLogoUrl || undefined;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // A new URL deserves a fresh attempt — otherwise one broken logo would keep the
  // Fluent mark pinned for the rest of the session.
  useEffect(() => setFailedSrc(null), [src]);

  if (!src || failedSrc === src) {
    return <Icon name="fluent" className={cn("size-3", className)} />;
  }

  return (
    <img
      src={src}
      alt=""
      className="size-full rounded-md object-cover"
      onError={() => setFailedSrc(src)}
    />
  );
}
