/**
 * @vitest-environment jsdom
 *
 * `FieldError`: the one message, or the list of distinct messages, it draws from a form's errors,
 * and which list items keep their DOM when the errors change. No fakes.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldError } from "./field";

type Errors = Array<{ message?: string } | undefined>;

function renderErrors(errors: Errors) {
  const view = render(
    <StrictMode>
      <FieldError errors={errors} />
    </StrictMode>,
  );
  return (next: Errors, className?: string) =>
    view.rerender(
      <StrictMode>
        <FieldError errors={next} className={className} />
      </StrictMode>,
    );
}

const items = () => screen.queryAllByRole("listitem");

afterEach(cleanup);

describe("FieldError", () => {
  it("draws nothing without errors or children", () => {
    renderErrors([]);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws a single distinct message as text, without a list", () => {
    renderErrors([{ message: "Required" }, { message: "Required" }]);

    expect(screen.getByRole("alert").textContent).toBe("Required");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lists each distinct message once, in first-seen order, and skips one without a message", () => {
    renderErrors([
      { message: "Too short" },
      undefined,
      { message: "Not a number" },
      { message: "Too short" },
    ]);

    expect(items().map((item) => item.textContent)).toEqual(["Too short", "Not a number"]);
  });

  it("keeps the list on an unrelated render", () => {
    const rerender = renderErrors([{ message: "Too short" }, { message: "Not a number" }]);
    const [first, second] = items();

    rerender([{ message: "Too short" }, { message: "Not a number" }], "unrelated");

    const next = items();
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
    expect(screen.getByRole("alert").className).toContain("unrelated");
  });

  it("reuses the first list item's DOM for the next message when the first error goes", () => {
    const rerender = renderErrors([
      { message: "Too short" },
      { message: "Not a number" },
      { message: "Out of range" },
    ]);
    const [first, second, third] = items();

    rerender([{ message: "Not a number" }, { message: "Out of range" }]);

    // Pins current behaviour: items are keyed by position, so the first `<li>` takes the second message.
    const next = items();
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
    expect(first!.textContent).toBe("Not a number");
    expect(second!.textContent).toBe("Out of range");
    expect(third!.isConnected).toBe(false);
  });

  it("reuses the list items' DOM by position when the messages are reordered", () => {
    const rerender = renderErrors([{ message: "Too short" }, { message: "Not a number" }]);
    const [first, second] = items();

    rerender([{ message: "Not a number" }, { message: "Too short" }]);

    // Pins current behaviour: items are keyed by position, so each `<li>` swaps its text rather than moving.
    const next = items();
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
    expect(first!.textContent).toBe("Not a number");
  });

  it("draws its children instead of the errors", () => {
    render(
      <StrictMode>
        <FieldError errors={[{ message: "Too short" }]}>Custom</FieldError>
      </StrictMode>,
    );

    expect(screen.getByRole("alert").textContent).toBe("Custom");
  });
});
