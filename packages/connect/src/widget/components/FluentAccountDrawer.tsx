import type { ReactNode } from "react";
import { ChevronLeft, Copy, ExternalLink, LogOut, Settings } from "lucide-react";

import { Icon } from "../../components/Icon";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "../../components/ui/drawer";
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
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  /** Preview harnesses relax these to keep the drawer pinned open; the widget keeps the modal defaults. */
  modal?: boolean | "trap-focus";
  disablePointerDismissal?: boolean;
  children: ReactNode;
  userLogoUrl?: string | null;
}

/**
 * The connected-account drawer shell: the connect-button trigger, the account
 * header/actions menu (explorer / copy / settings / disconnect), and a slot
 * (`children`) for the wallet menu card. Rendered whenever the widget has a
 * connected account.
 */
export function FluentAccountDrawer({
  accountOpen,
  setAccountOpen,
  hasConnectedAccount,
  isMobile,
  connectButton,
  accountMenuAddress,
  onAccountMenuAction,
  settingsOpen,
  onCloseSettings,
  modal,
  disablePointerDismissal,
  children,
  userLogoUrl,
}: FluentAccountDrawerProps) {
  return (
    <Drawer
      open={hasConnectedAccount && accountOpen}
      onOpenChange={setAccountOpen}
      swipeDirection={isMobile ? "down" : "right"}
      modal={modal}
      disablePointerDismissal={disablePointerDismissal}
    >
      {connectButton}

      {hasConnectedAccount ? (
        <DrawerContent aria-label="Connected account" className="dark text-foreground antialiased sm:w-96">
          <DrawerHeader className="items-stretch p-4 pb-0">
            {settingsOpen ? (
              <div className="relative flex h-11 items-center justify-center">
                <button
                  type="button"
                  aria-label="Back"
                  className="absolute left-0 inline-flex size-8 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  onClick={onCloseSettings}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <DrawerTitle className="text-sm font-medium leading-none text-foreground">
                  Settings
                </DrawerTitle>
              </div>
            ) : accountMenuAddress ? (
              <Select value={null} onValueChange={onAccountMenuAction}>
                <SelectTrigger
                  aria-label="Account actions"
                  className="!h-auto w-full gap-2 overflow-hidden rounded-xl border border-foreground/10 !bg-transparent p-1.5 pr-3 hover:border-foreground/20 hover:!bg-foreground/5 aria-expanded:border-foreground/20 aria-expanded:!bg-foreground/5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/10 text-foreground">
                    {userLogoUrl ? (
                      <img src={userLogoUrl} alt="User logo" className="rounded-md" />
                    ) : (
                      <Icon name="fluent" className="size-3" />
                    )}
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
                <div className="relative z-10 flex size-8 items-center justify-center rounded-md bg-foreground/10">
                  <Icon name="fluent" className="size-3" />
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
