/**
 * @vitest-environment jsdom
 *
 * The drawer mounts its content afresh on every opening: the wallet menu's card reads its
 * balances on mount, so a drawer that kept its content mounted would show the balances of an
 * earlier opening.
 */
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { FluentAccountDrawer } from "./FluentAccountDrawer";

function Content({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div>wallet menu</div>;
}

function renderDrawer(open: boolean, onMount: () => void) {
  return (
    <FluentAccountDrawer
      accountOpen={open}
      setAccountOpen={() => {}}
      hasConnectedAccount
      isMobile={false}
      connectButton={<button type="button">account</button>}
      onAccountMenuAction={() => {}}
    >
      <Content onMount={onMount} />
    </FluentAccountDrawer>
  );
}

afterEach(cleanup);

describe("FluentAccountDrawer reopening", () => {
  it("mounts its content again each time it opens", async () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };
    const { rerender } = render(renderDrawer(false, onMount));
    expect(mounts).toBe(0);

    await act(async () => rerender(renderDrawer(true, onMount)));
    expect(mounts).toBe(1);

    await act(async () => rerender(renderDrawer(false, onMount)));
    await act(async () => rerender(renderDrawer(true, onMount)));
    expect(mounts).toBe(2);
  });
});
