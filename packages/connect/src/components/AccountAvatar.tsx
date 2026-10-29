import { useEffect, useState } from "react";

import { Icon } from "./Icon";
import { cn } from "../lib/utils";

/** The props of `AccountAvatar`. */
export type AccountAvatarProps = {
  /**
   * The person's linked X picture, the render context's `userAvatarUrl`. Wins over
   * `defaultLogoUrl`.
   */
  userAvatarUrl?: string | null;
  /** Host-supplied stand-in for the Fluent mark — a URL or a data URI. */
  defaultLogoUrl?: string | null;
  className?: string;
};

/**
 * The Account avatar: the person's linked X picture, else the host's default logo, else the
 * Fluent mark.
 *
 * @example
 * ```tsx
 * import { AccountAvatar, useFluentWidget } from "@fluent.xyz/connect";
 *
 * export function Avatar() {
 *   const { userAvatarUrl } = useFluentWidget();
 *   return <AccountAvatar userAvatarUrl={userAvatarUrl} />;
 * }
 * ```
 */
export function AccountAvatar({ userAvatarUrl, defaultLogoUrl, className }: AccountAvatarProps) {
  const src = userAvatarUrl || defaultLogoUrl || undefined;
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
