/**
 * Gives Reown AppKit's `<w3m-modal>` a home it never leaves: `dialog[data-fluent-wallet-modal]`,
 * opened with `showModal()` while the modal is open, so it paints above the widget's and an App's
 * modal dialogs and is not inert under them.
 *
 * The element must never move. AppKit's components subscribe to its stores in their constructors
 * and unsubscribe in `disconnectedCallback`, and a DOM move (`moveBefore` included, as none of them
 * defines `connectedMoveCallback`) runs that callback. A moved `<w3m-modal>` then stops following
 * AppKit for the rest of the page: the WalletConnect URI never reaches the QR or the mobile deep
 * link, a tapped wallet opens no view, and the close button no longer closes.
 *
 * Needs `createAppKit({ disableAppend: true })`, or AppKit appends its own `<w3m-modal>` to
 * `document.body` first.
 */
export function mountWalletModal(): void {
  if (document.querySelector("dialog[data-fluent-wallet-modal]")) return;

  // An App's own `createAppKit` may have appended a `<w3m-modal>` already, and a second one would
  // open beside it. A removed element unsubscribes from AppKit's stores.
  for (const stray of document.querySelectorAll("w3m-modal")) stray.remove();

  const dialog = document.createElement("dialog");
  dialog.setAttribute("data-fluent-wallet-modal", "");
  // AppKit handles Esc itself; the dialog only follows the modal's open state.
  dialog.addEventListener("cancel", (event) => event.preventDefault());

  // Defined once AppKit loads its UI; the element upgrades in place.
  const modal = document.createElement("w3m-modal");
  dialog.appendChild(modal);
  document.body.appendChild(dialog);

  const follow = () => {
    const open = modal.classList.contains("open");
    if (open === dialog.open) return;
    try {
      if (open) dialog.showModal();
      else dialog.close();
    } catch {
      /* jsdom without the polyfill, or a detached element */
    }
  };
  new MutationObserver(follow).observe(modal, { attributes: true, attributeFilter: ["class"] });
  // A browser may force-close the dialog past a prevented `cancel` (close watchers); reopen it
  // while AppKit still shows the modal, or the modal stays open but invisible.
  dialog.addEventListener("close", follow);
}
