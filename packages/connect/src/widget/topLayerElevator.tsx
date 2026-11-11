import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useFluentToastLayer, useFluentTopLayer } from "./portalContainer";

/*
 * Third-party overlays the widget opens render as plain `position: fixed` elements it cannot
 * re-target: Privy's prompt (`#privy-dialog`: login MFA, recovery, the signing confirmation),
 * Reown's wallet modal (`<w3m-modal>`) and the RainbowKit connect modal the bridge page's wallet
 * picker portals into `document.body`. Under a modal dialog in the top layer, an App's
 * `showModal()` or the widget's own overlay host, they are painted over and inert.
 *
 * While such a dialog is open, the elevator moves the open overlays into
 * `dialog[data-fluent-top-layer]` and holds that host open, where they are interactive and painted
 * above everything; a comment placeholder marks each original spot, and a node moves back once no
 * modal dialog needs beating. Privy's React tree must not notice the move: see `patchParent`. The
 * toast layer is an always-open popover that a later modal dialog paints over, so the elevator
 * re-shows it whenever another modal dialog opens.
 */

type ElevatorTarget = {
  find: () => HTMLElement | null;
  /** Mounted-but-closed overlays (Reown keeps its element around) stay put. */
  isOpen: (node: HTMLElement) => boolean;
  /** Attributes whose changes signal open/close, watched per found node. */
  watchAttributes?: string[];
  /** Watch the whole subtree — Privy marks closing on inner elements. */
  watchSubtree?: boolean;
};

/**
 * Privy's prompt is a Headless UI `<Transition>`, whose leave machinery stalls
 * when the element plays it out inside the top-layer host — the node then never
 * unmounts and the hold is never released. The moment the leave starts (the
 * `leaving` class from Privy's `leaveTo`, or Headless UI's own `data-leave`)
 * the prompt must count as closed, so it is moved home and finishes there.
 */
const privyPromptIsClosing = (node: HTMLElement) =>
  node.matches("[data-leave]") || node.querySelector(".leaving, [data-leave]") !== null;

const TARGETS: ElevatorTarget[] = [
  {
    // Privy mounts the prompt only while it is showing or animating away.
    find: () => document.getElementById("privy-dialog"),
    isOpen: (node) => !privyPromptIsClosing(node),
    watchAttributes: ["class", "data-leave"],
    watchSubtree: true,
  },
  {
    find: () => document.querySelector<HTMLElement>("w3m-modal"),
    isOpen: (node) => node.classList.contains("open"),
    watchAttributes: ["class"],
  },
  {
    // RainbowKit 2.2.8 portals the modal into `document.body` only while it is
    // open; the node that moves is that portal's top element, not the dialog.
    find: findRainbowKitModalRoot,
    isOpen: () => true,
  },
];

function findRainbowKitModalRoot(): HTMLElement | null {
  let node = document.querySelector<HTMLElement>('[data-rk][role="dialog"][aria-modal="true"]');
  while (node?.parentElement && node.parentElement !== document.body) node = node.parentElement;
  // Once elevated, the walk ends on the top-layer host itself.
  if (!node || node.parentElement !== document.body) return null;
  return node.hasAttribute("data-fluent-top-layer") ? null : node;
}

type MoveCapableParent = ParentNode & {
  moveBefore?: (node: Node, child: Node | null) => void;
};

/** `moveBefore` keeps focus, animations and iframes alive; Safari falls back. */
function movePreservingState(parent: ParentNode, node: Node, before: Node | null) {
  const moveBefore = (parent as MoveCapableParent).moveBefore;
  if (typeof moveBefore === "function") {
    try {
      moveBefore.call(parent, node, before);
      return;
    } catch {
      /* disconnected target — the plain insert below throws the real error */
    }
  }
  parent.insertBefore(node, before);
}

function isModalDialog(dialog: HTMLDialogElement): boolean {
  // `:modal` is only meaningful where `showModal()` is the browser's own — in
  // jsdom (a polyfill, no top layer) an open dialog is close enough.
  const native = /\[native code\]/.test(String(Object.getPrototypeOf(dialog).showModal ?? ""));
  if (!native) return true;
  try {
    return dialog.matches(":modal");
  } catch {
    return true;
  }
}

type ElevatedEntry = {
  target: ElevatorTarget;
  placeholder: Comment;
  unpatchParent: () => void;
  release: () => void;
};

export function createTopLayerElevator({
  topLayerHost,
  acquire,
  toastLayer,
}: {
  topLayerHost: HTMLDialogElement;
  acquire: () => () => void;
  toastLayer?: HTMLElement | null;
}): () => void {
  const elevated = new Map<HTMLElement, ElevatedEntry>();
  const watched = new WeakSet<HTMLElement>();
  const targetObservers: MutationObserver[] = [];
  let foreignModalWasOpen = false;

  const foreignModalDialogOpen = () =>
    Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).some(
      (dialog) =>
        dialog !== topLayerHost &&
        !dialog.hasAttribute("data-fluent-top-layer") &&
        !topLayerHost.contains(dialog) &&
        isModalDialog(dialog),
    );

  /** A widget overlay is up — in the top layer the nodes would sit under it. */
  const hostHasOwnContent = () =>
    Array.from(topLayerHost.children).some(
      (child) =>
        !elevated.has(child as HTMLElement) &&
        !child.hasAttribute("data-fluent-top-layer-anchor") &&
        // The toast layer moves in while the host is open; it is not an overlay.
        !child.hasAttribute("data-fluent-toast-layer"),
    );

  // React removes a node from the parent it rendered it into. While the node is elevated, these
  // two instance patches keep that parent consistent: a removal finds the real node, and an
  // insertion before the node lands on the placeholder.
  const patchParent = (parent: Element, node: HTMLElement, marker: Comment) => {
    const parentWithMethods = parent as Element & {
      removeChild: typeof parent.removeChild;
      insertBefore: typeof parent.insertBefore;
    };
    const originalRemoveChild = parent.removeChild;
    const originalInsertBefore = parent.insertBefore;
    parentWithMethods.removeChild = function <T extends Node>(child: T): T {
      if ((child as Node) === node && child.parentNode !== parent) {
        child.parentNode?.removeChild(child);
        settle(node);
        return child;
      }
      return originalRemoveChild.call(this, child) as T;
    };
    parentWithMethods.insertBefore = function <T extends Node>(newNode: T, ref: Node | null): T {
      if (ref === node && ref.parentNode !== parent) {
        return originalInsertBefore.call(this, newNode, marker) as T;
      }
      return originalInsertBefore.call(this, newNode, ref) as T;
    };
    return () => {
      // Deleting the own properties re-exposes the prototype methods.
      delete (parentWithMethods as Partial<typeof parentWithMethods>).removeChild;
      delete (parentWithMethods as Partial<typeof parentWithMethods>).insertBefore;
    };
  };

  /** Drops an entry's bookkeeping; the node itself stays wherever it is. */
  const settle = (node: HTMLElement) => {
    const entry = elevated.get(node);
    if (!entry) return;
    elevated.delete(node);
    entry.unpatchParent();
    entry.placeholder.remove();
    entry.release();
  };

  const restore = (node: HTMLElement) => {
    const entry = elevated.get(node);
    if (!entry) return;
    if (topLayerHost.contains(node) && entry.placeholder.parentNode) {
      movePreservingState(entry.placeholder.parentNode, node, entry.placeholder);
    }
    settle(node);
  };

  const elevate = (node: HTMLElement, target: ElevatorTarget) => {
    const parent = node.parentElement;
    if (!parent) return;
    const placeholder = document.createComment("fluent-top-layer-elevated");
    parent.insertBefore(placeholder, node);
    elevated.set(node, {
      target,
      placeholder,
      unpatchParent: patchParent(parent, node, placeholder),
      release: acquire(),
    });
    movePreservingState(topLayerHost, node, null);
  };

  const ensureWatched = (node: HTMLElement, target: ElevatorTarget) => {
    if (!target.watchAttributes || watched.has(node)) return;
    watched.add(node);
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      attributes: true,
      attributeFilter: target.watchAttributes,
      subtree: target.watchSubtree ?? false,
    });
    targetObservers.push(observer);
  };

  /** A modal dialog shown after the toast popover paints above it; re-show. */
  const promoteToastLayer = (foreignModalOpen: boolean) => {
    if (!toastLayer || foreignModalOpen === foreignModalWasOpen) {
      foreignModalWasOpen = foreignModalOpen;
      return;
    }
    foreignModalWasOpen = foreignModalOpen;
    if (!foreignModalOpen) return;
    try {
      toastLayer.hidePopover?.();
      toastLayer.showPopover?.();
    } catch {
      /* no Popover API — the layer already behaves like a plain root */
    }
  };

  const sync = () => {
    const foreignModalOpen = foreignModalDialogOpen();
    promoteToastLayer(foreignModalOpen);
    const needsElevation = foreignModalOpen || hostHasOwnContent();

    for (const [node, entry] of Array.from(elevated)) {
      if (!node.isConnected || !topLayerHost.contains(node)) {
        // Gone, or something else moved it; either way stop tracking.
        settle(node);
      } else if (!needsElevation || !entry.target.isOpen(node)) {
        restore(node);
      }
    }

    for (const target of TARGETS) {
      const node = target.find();
      if (!node || !node.isConnected) continue;
      ensureWatched(node, target);
      if (!needsElevation || elevated.has(node) || topLayerHost.contains(node)) continue;
      if (!target.isOpen(node)) continue;
      elevate(node, target);
    }
  };

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  sync();

  return () => {
    observer.disconnect();
    for (const targetObserver of targetObservers) targetObserver.disconnect();
    for (const node of Array.from(elevated.keys())) restore(node);
  };
}

/**
 * The component that runs the elevator and keeps one permanent React portal in the top-layer
 * host, so React's delegated event listeners are attached to it: an elevated node's events then
 * reach its owner's handlers through the fiber tree although the node has left its DOM position.
 */
export function FluentTopLayerBridge() {
  const topLayer = useFluentTopLayer();
  const toastLayer = useFluentToastLayer();

  useEffect(() => {
    if (!topLayer) return;
    return createTopLayerElevator({
      topLayerHost: topLayer.element,
      acquire: topLayer.acquire,
      toastLayer,
    });
  }, [topLayer, toastLayer]);

  if (!topLayer) return null;
  return createPortal(<span hidden data-fluent-top-layer-anchor="" />, topLayer.element);
}
