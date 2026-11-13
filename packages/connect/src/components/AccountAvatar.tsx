import { useState } from "react";

import { Icon } from "./Icon";
import { cn } from "../lib/utils";

/** The props of `AccountAvatar`. */
export type AccountAvatarProps = {
  /**
   * The person's linked X picture, the render context's `userAvatarUrl`. Wins over
   * `defaultLogoUrl`.
   */
  userAvatarUrl?: string | null;
  /** The App's stand-in for the Fluent mark: a URL or a data URI. */
  defaultLogoUrl?: string | null;
  /** Classes added to the Fluent mark when it is drawn; the image does not take them. */
  className?: string;
};

/**
 * The Account avatar: the person's linked X picture, else the App's default logo, else the
 * Fluent mark. An image that fails to load falls back to the Fluent mark until the URL changes.
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
  const [renderedSrc, setRenderedSrc] = useState(src);

  // A new URL gets a fresh attempt, a URL that failed before included: otherwise one broken logo
  // would keep the Fluent mark in place for as long as the component is mounted.
  if (renderedSrc !== src) {
    setRenderedSrc(src);
    setFailedSrc(null);
  }

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
