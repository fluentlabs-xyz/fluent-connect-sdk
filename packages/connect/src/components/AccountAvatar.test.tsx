/**
 * @vitest-environment jsdom
 *
 * The Account avatar's image and its fallback to the Fluent mark when the image fails to load,
 * across changes of the URL it draws. No fakes: jsdom's `error` event stands for a broken image.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { AccountAvatar, type AccountAvatarProps } from "./AccountAvatar";

const PICTURE = "https://pbs.twimg.com/profile_images/1/picture.png";
const LOGO = "https://app.example/logo.png";
const OTHER_PICTURE = "https://pbs.twimg.com/profile_images/2/picture.png";

function renderAvatar(props: AccountAvatarProps) {
  const view = render(
    <StrictMode>
      <AccountAvatar {...props} />
    </StrictMode>,
  );
  return {
    ...view,
    rerender: (next: AccountAvatarProps) =>
      view.rerender(
        <StrictMode>
          <AccountAvatar {...next} />
        </StrictMode>,
      ),
    image: () => view.container.querySelector("img"),
    mark: () => view.container.querySelector("svg"),
  };
}

afterEach(cleanup);

describe("AccountAvatar", () => {
  it("draws the linked X picture over the default logo", () => {
    const view = renderAvatar({ userAvatarUrl: PICTURE, defaultLogoUrl: LOGO });

    expect(view.image()?.getAttribute("src")).toBe(PICTURE);
    expect(view.mark()).toBeNull();
  });

  it("draws the Fluent mark with the given classes when there is no URL", () => {
    const view = renderAvatar({ userAvatarUrl: null, defaultLogoUrl: "", className: "mark" });

    expect(view.image()).toBeNull();
    expect(view.mark()?.getAttribute("class")).toContain("mark");
  });

  it("falls back to the Fluent mark after the image fails and keeps it on an unrelated render", () => {
    const view = renderAvatar({ userAvatarUrl: PICTURE });

    fireEvent.error(view.image()!);
    expect(view.image()).toBeNull();
    expect(view.mark()).not.toBeNull();

    view.rerender({ userAvatarUrl: PICTURE, className: "unrelated" });
    expect(view.image()).toBeNull();
    expect(view.mark()?.getAttribute("class")).toContain("unrelated");
  });

  it("gives a new URL a fresh attempt after the previous one failed", () => {
    const view = renderAvatar({ userAvatarUrl: PICTURE });
    fireEvent.error(view.image()!);

    view.rerender({ userAvatarUrl: OTHER_PICTURE });

    expect(view.image()?.getAttribute("src")).toBe(OTHER_PICTURE);
  });

  it("gives a failed URL a fresh attempt when it comes back after another URL", () => {
    const view = renderAvatar({ userAvatarUrl: PICTURE });
    fireEvent.error(view.image()!);
    view.rerender({ userAvatarUrl: OTHER_PICTURE });

    view.rerender({ userAvatarUrl: PICTURE });

    // Pins current behaviour: the effect on `src` clears the failure, so the broken URL is tried again.
    expect(view.image()?.getAttribute("src")).toBe(PICTURE);
    expect(view.mark()).toBeNull();
  });

  it("tries the default logo when the picture is removed after it failed", () => {
    const view = renderAvatar({ userAvatarUrl: PICTURE, defaultLogoUrl: LOGO });
    fireEvent.error(view.image()!);
    expect(view.mark()).not.toBeNull();

    view.rerender({ userAvatarUrl: null, defaultLogoUrl: LOGO });

    expect(view.image()?.getAttribute("src")).toBe(LOGO);
  });
});
