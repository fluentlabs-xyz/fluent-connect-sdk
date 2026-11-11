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
   * Title of the sub-page replacing the wallet menu (Settings, Send, …). Set, the header becomes
   * a back button and this title.
   */
  subPageTitle?: string | null;
  onCloseSubPage?: () => void;
  /**
   * How the sub-page is left: `back` is a chevron on the left that walks up the stack; `close`
   * is an X on the right, for a page that stands alone, such as a Review the person is answering.
   */
  subPageDismiss?: "back" | "close";
  /** @deprecated Pass `subPageTitle="Settings"` and `onCloseSubPage` instead. */
  settingsOpen?: boolean;
  /** @deprecated Use `onCloseSubPage`. */
  onCloseSettings?: () => void;
  /**
   * Preview harnesses relax these to keep the drawer pinned open; the widget keeps the modal
   * defaults.
   */
  modal?: boolean | "trap-focus";
  disablePointerDismissal?: boolean;
  children: ReactNode;
  userAvatarUrl?: string | null;
  /** Shown instead of the Fluent mark when there is no `userAvatarUrl` — a URL or a data URI. */
  defaultLogoUrl?: string | null;
}

/**
 * The account drawer: the connect button that opens it, the account header with its actions menu
 * (explorer, copy, settings, disconnect), and `children`, the wallet menu card. Its content
 * renders only while the widget has a connected account.
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

  // Losing the account removes the popup in the same commit, so base-ui never finishes the close
  // and the drawer keeps the top-layer `<dialog>` open, leaving the page inert; `unmount` finishes
  // it. On the edge only: `unmount` on a drawer never mounted would report a false close.
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
      showSwipeHandle={isMobile}
      modal={modal}
      disablePointerDismissal={disablePointerDismissal}
    >
      {connectButton}

      {hasConnectedAccount ? (
        <DrawerContent
          aria-label="Connected account"
          // The swipe axis is y only on mobile: the sheet fills the viewport there, so moving
          // between pages of different lengths does not resize it.
          className="dark text-foreground antialiased data-[swipe-axis=y]:[--drawer-content-height:calc(100dvh-2*var(--drawer-inset))] data-[swipe-axis=y]:[--drawer-content-max-height:none]"
        >
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
              <div className="relative flex items-center gap-2">
                <Select value={null} onValueChange={onAccountMenuAction}>
                  <SelectTrigger
                    aria-label="Account actions"
                    className={`!h-auto min-w-0 ${isMobile ? "w-fit" : "w-full"} gap-2 overflow-hidden rounded-xl border-0 !bg-transparent p-1.5 pr-3 hover:!bg-foreground/5 aria-expanded:!bg-foreground/5`}
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-foreground/10 text-foreground">
                      <AccountAvatar
                        userAvatarUrl={userAvatarUrl}
                        defaultLogoUrl={defaultLogoUrl}
                      />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-none text-foreground">
                      {formatAddress(accountMenuAddress)}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    // On mobile the trigger is only as wide as the address, at the header's left.
                    align={isMobile ? "start" : "end"}
                    alignItemWithTrigger={false}
                    className="w-56 min-w-(--anchor-width)"
                  >
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
                {isMobile ? (
                  <button
                    type="button"
                    aria-label="Close"
                    className="absolute -right-1 -top-4 inline-flex size-8 items-center justify-center rounded-full bg-white/10 text-foreground/70 transition-colors hover:bg-white/15 hover:text-foreground"
                    onClick={() => setAccountOpen(false)}
                  >
                    <X className="size-5" />
                  </button>
                ) : null}
              </div>
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
