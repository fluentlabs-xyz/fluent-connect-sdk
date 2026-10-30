import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, Copy, ExternalLink, LogOut, Settings, X } from "lucide-react";

import { AccountAvatar } from "../../components/AccountAvatar";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  type DrawerActions,
} from "../../components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "../../components/ui/select";
import { formatAddress } from "../../utils";

interface FluentAccountDrawerProps {
  accountOpen: boolean;
  setAccountOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  hasConnectedAccount: boolean;
  isMobile: boolean;
  connectButton: ReactNode;
  accountMenuAddress?: string;
  onAccountMenuAction: (value: string | null) => void;
  /**
   * Title of the sub-page currently replacing the wallet menu (Settings,
   * Deposit, …). Set it and the header becomes a back
   * button plus this title.
   */
  subPageTitle?: string | null;
  onCloseSubPage?: () => void;
  /**
   * How the sub-page is left: `back` is a chevron on the left that walks up the
   * stack; `close` is an X on the right, for a page that stands alone, such as
   * a review the user is answering.
   */
  subPageDismiss?: "back" | "close";
  /** @deprecated Pass `subPageTitle="Settings"` and `onCloseSubPage` instead. */
  settingsOpen?: boolean;
  /** @deprecated Renamed to `onCloseSubPage`. */
  onCloseSettings?: () => void;
  /** Preview harnesses relax these to keep the drawer pinned open; the widget keeps the modal defaults. */
  modal?: boolean | "trap-focus";
  disablePointerDismissal?: boolean;
  children: ReactNode;
  userAvatarUrl?: string | null;
  /** Shown instead of the Fluent mark when there is no `userAvatarUrl` — a URL or a data URI. */
  defaultLogoUrl?: string | null;
}

/**
 * The connected-account drawer shell: the connect-button trigger, the account
 * header/actions menu (explorer / copy / settings /
 * disconnect), and a slot (`children`) for the wallet menu card. Rendered
 * whenever the widget has a connected account.
 */
export function FluentAccountDrawer({
  accountOpen,
  setAccountOpen,
  hasConnectedAccount,
  isMobile,
  connectButton,
  accountMenuAddress,
  onAccountMenuAction,
  subPageTitle,
  onCloseSubPage,
  subPageDismiss = "back",
  settingsOpen,
  onCloseSettings,
  modal,
  disablePointerDismissal,
  children,
  userAvatarUrl,
  defaultLogoUrl,
}: FluentAccountDrawerProps) {
  const subPage = subPageTitle ?? (settingsOpen ? "Settings" : null);
  const closeSubPage = onCloseSubPage ?? onCloseSettings;

  // Losing the account while the drawer is open closes it and takes its parts
  // out of the tree in the same commit, and base-ui finishes a close by waiting
  // on the popup element: already gone, so the wait is never scheduled and the
  // drawer stays mounted in the drawer's own state for good. Nothing shows while
  // the account is away, but the moment one is back the portal returns — closed,
  // invisible, and holding the widget's top-layer `<dialog>` open through
  // `FluentTopLayerSlot`. An open modal dialog makes the rest of the document
  // inert, so from then on the trigger button cannot be pressed at all and only
  // a reload brings the page back. Finish that close by hand instead, which is
  // what `unmount` is for.
  //
  // The edge, not the value: `unmount` on a drawer that was never mounted would
  // report a close that never happened.
  const drawerActions = useRef<DrawerActions | null>(null);
  const wasConnected = useRef(hasConnectedAccount);
  useEffect(() => {
    if (wasConnected.current === hasConnectedAccount) return;
    wasConnected.current = hasConnectedAccount;
    if (!hasConnectedAccount) drawerActions.current?.unmount();
  }, [hasConnectedAccount]);

  return (
    <Drawer
      open={hasConnectedAccount && accountOpen}
      onOpenChange={setAccountOpen}
      actionsRef={drawerActions}
      swipeDirection={isMobile ? "down" : "right"}
      modal={modal}
      disablePointerDismissal={disablePointerDismissal}
    >
      {connectButton}

      {hasConnectedAccount ? (
        <DrawerContent aria-label="Connected account" className="dark text-foreground antialiased sm:w-96">
          <DrawerHeader className="items-stretch p-4 pb-0">
            {subPage ? (
              <div className="relative flex h-11 items-center justify-center">
                <button
                  type="button"
                  aria-label={subPageDismiss === "close" ? "Close" : "Back"}
                  className={`absolute inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground ${
                    subPageDismiss === "close" ? "right-0" : "left-0"
                  }`}
                  onClick={closeSubPage}
                >
                  {subPageDismiss === "close" ? <X className="size-5" /> : <ChevronLeft className="size-5" />}
                </button>
                <DrawerTitle className="text-sm font-medium leading-none text-foreground">
                  {subPage}
                </DrawerTitle>
              </div>
            ) : accountMenuAddress ? (
              <Select value={null} onValueChange={onAccountMenuAction}>
                <SelectTrigger
                  aria-label="Account actions"
                  className="!h-auto w-full gap-2 overflow-hidden rounded-xl border border-foreground/10 !bg-transparent p-1.5 pr-3 hover:border-foreground/20 hover:!bg-foreground/5 aria-expanded:border-foreground/20 aria-expanded:!bg-foreground/5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground/10 text-foreground">
                    <AccountAvatar userAvatarUrl={userAvatarUrl} defaultLogoUrl={defaultLogoUrl} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-none text-foreground">
                    {formatAddress(accountMenuAddress)}
                  </span>
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false} className="min-w-(--anchor-width)">
                  <SelectItem value="explorer">
                    <ExternalLink className="size-4" />
                    Open on FluentScan
                  </SelectItem>
                  <SelectItem value="copy">
                    <Copy className="size-4" />
                    Copy address
                  </SelectItem>
                  <SelectSeparator className="mx-2" />
                  <SelectItem value="settings">
                    <Settings className="size-4" />
                    Settings
                  </SelectItem>
                  <SelectSeparator className="mx-2" />
                  <SelectItem value="disconnect">
                    <LogOut className="size-4" />
                    Disconnect
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-foreground/10 p-2 pr-3 shadow-2xl">
                <div className="relative z-10 flex size-8 items-center justify-center overflow-hidden rounded-md bg-foreground/10">
                  <AccountAvatar userAvatarUrl={userAvatarUrl} defaultLogoUrl={defaultLogoUrl} />
                </div>
                <div className="relative z-10 text-sm font-medium leading-none">Connected</div>
              </div>
            )}
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">{children}</div>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}
