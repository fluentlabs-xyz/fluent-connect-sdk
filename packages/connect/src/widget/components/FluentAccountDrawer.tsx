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
import { formatAddress } from "../../utils/formatAddress";

/**
 * The connected-account drawer shell: the connect-button trigger, the account
 * header/actions menu (explorer / copy / settings / disconnect), and a slot
 * (`children`) for the wallet menu card. Rendered whenever the widget has a
 * connected account.
 */
export function FluentAccountDrawer(props: {
  accountOpen: boolean;
  setAccountOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  hasConnectedAccount: boolean;
  isMobile: boolean;
  connectButton: ReactNode;
  accountMenuAddress?: string;
  onAccountMenuAction: (value: string | null) => void;
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  children: ReactNode;
}) {
  const {
    accountOpen,
    setAccountOpen,
    hasConnectedAccount,
    isMobile,
    connectButton,
    accountMenuAddress,
    onAccountMenuAction,
    settingsOpen = false,
    onCloseSettings,
    children,
  } = props;

  return (
    <Drawer
      open={hasConnectedAccount && accountOpen}
      onOpenChange={setAccountOpen}
      swipeDirection={isMobile ? "down" : "right"}
    >
      {connectButton}

      {hasConnectedAccount ? (
        <DrawerContent aria-label="Connected account" className="dark text-white antialiased sm:w-96">
          <DrawerHeader className="items-stretch p-4 pb-0">
            {settingsOpen ? (
              <div className="relative flex h-11 items-center justify-center">
                <button
                  type="button"
                  aria-label="Back"
                  className="absolute left-0 inline-flex size-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                  onClick={onCloseSettings}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <DrawerTitle className="text-sm font-medium leading-none text-white">
                  Settings
                </DrawerTitle>
              </div>
            ) : accountMenuAddress ? (
              <Select value={null} onValueChange={onAccountMenuAction}>
                <SelectTrigger
                  aria-label="Account actions"
                  className="!h-auto w-full gap-2 overflow-hidden rounded-xl border border-white/10 !bg-transparent p-1.5 pr-3 hover:border-white/20 hover:!bg-white/5 aria-expanded:border-white/20 aria-expanded:!bg-white/5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-white">
                    <Icon name="fluent" className="size-3" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-none text-white">
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
              <div className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 p-2 pr-3 shadow-2xl">
                <div className="relative z-10 flex size-8 items-center justify-center rounded-md bg-white/10">
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
