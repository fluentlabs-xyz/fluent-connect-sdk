import { useRef, useState } from "react";

/**
 * FLU-1469 repro: a modal the chess app itself owns, opened with
 * `HTMLDialogElement.showModal()`. The browser puts it in the top layer and
 * makes the rest of the document inert.
 *
 * The widget's own overlays (sign-in, transaction/signature review) claim the
 * top layer themselves and rise above this dialog, and the widget elevates the
 * Privy prompt the same way. "Sign message" walks the full path: the signature
 * review opens on top, and after confirming it the Privy signature prompt must
 * also appear above this dialog, clickable. Quick sign must be off, or Privy
 * signs silently and never prompts.
 */
export function HostModalRepro({
  onConnect,
  onCreateGame,
  onSignMessage,
}: {
  onConnect: () => void;
  onCreateGame: () => void;
  onSignMessage: () => Promise<string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [signStatus, setSignStatus] = useState<string | null>(null);

  return (
    <div className="chess-setup-flow">
      <button type="button" onClick={() => ref.current?.showModal()}>
        Open host modal (FLU-1469 repro)
      </button>
      <dialog ref={ref} className="chess-host-dialog" aria-label="Chess app modal">
        <p className="chess-host-dialog-eyebrow">The chess app&rsquo;s own modal</p>
        <h3>This dialog belongs to the host, not the widget</h3>
        <p>
          It was opened with <code>showModal()</code>, so the browser holds it in the
          top layer and makes the rest of the page inert. Every widget overlay must
          still rise above it: run <em>Sign message</em> (signed in, Quick sign off),
          confirm the review that opens on top — and the Privy signature prompt that
          follows must appear above this dialog too, fully clickable.
        </p>
        <div className="chess-host-dialog-actions">
          <button type="button" onClick={onConnect}>
            Connect Fluent ID
          </button>
          <button type="button" onClick={onCreateGame}>
            Create game (opens review)
          </button>
          <button
            type="button"
            onClick={() => {
              setSignStatus("Review should open on top; the Privy prompt comes after confirm.");
              onSignMessage()
                .then((signature) => setSignStatus(`Signed: ${signature.slice(0, 18)}…`))
                .catch((error) =>
                  setSignStatus(error instanceof Error ? error.message : "Signing failed"),
                );
            }}
          >
            Sign message (Privy prompt)
          </button>
          <button type="button" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
        {signStatus ? <p className="chess-host-dialog-status">{signStatus}</p> : null}
      </dialog>
    </div>
  );
}
