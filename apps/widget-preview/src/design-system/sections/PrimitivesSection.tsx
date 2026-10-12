import { Button } from "@fluent.xyz/connect/internal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fluent.xyz/connect/internal/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@fluent.xyz/connect/internal/ui/drawer";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@fluent.xyz/connect/internal/ui/field";
import { Label } from "@fluent.xyz/connect/internal/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@fluent.xyz/connect/internal/ui/select";
import { Separator } from "@fluent.xyz/connect/internal/ui/separator";
import { Spinner } from "@fluent.xyz/connect/internal/ui/spinner";
import { Switch } from "@fluent.xyz/connect/internal/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@fluent.xyz/connect/internal/ui/tabs";
import { toast } from "@fluent.xyz/connect/internal/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@fluent.xyz/connect/internal/ui/tooltip";
import { CircleHelp, Copy, ExternalLink, Wallet } from "lucide-react";
import { useState } from "react";

import { Row, Section, Specimen, SpecimenGrid } from "../Specimen";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const SIZES = ["default", "lg", "sm", "xs"] as const;
const ICON_SIZES = ["icon-lg", "icon", "icon-sm", "icon-xs"] as const;

function ButtonSpecimen() {
  return (
    <Specimen title="Button" note="Six variants, four sizes, four icon sizes; secondary reads the --button tokens." status="tokens" wide>
      <div className="flex flex-col gap-4">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                <Wallet />
                {size === "default" ? "Continue" : size}
              </Button>
            ))}
            {ICON_SIZES.map((size) => (
              <Button key={size} variant={variant} size={size} aria-label={size}>
                <Wallet />
              </Button>
            ))}
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </Row>
        ))}
        <Row label="as a link (href)">
          <Button href="https://fluent.xyz" target="_blank" rel="noreferrer">
            <ExternalLink />
            Open fluent.xyz
          </Button>
          <Button variant="secondary" className="w-full">
            Full width
          </Button>
        </Row>
      </div>
    </Specimen>
  );
}

function SwitchSpecimen() {
  const [on, setOn] = useState(true);
  return (
    <Specimen title="Switch" note="Two sizes. The thumb takes --primary; the track --input when off." status="tokens">
      <Row label="default">
        <Switch checked={on} onCheckedChange={setOn} aria-label="Toggle" />
        <Switch checked={!on} onCheckedChange={(next) => setOn(!next)} aria-label="Toggle inverse" />
        <Switch checked disabled aria-label="On, disabled" />
        <Switch checked={false} disabled aria-label="Off, disabled" />
      </Row>
      <Row label="sm">
        <Switch size="sm" checked={on} onCheckedChange={setOn} aria-label="Toggle small" />
        <Switch size="sm" checked={false} aria-label="Off small" />
      </Row>
      <Row label="in a label">
        <Label className="justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
          <span className="font-normal">Quick sign</span>
          <Switch checked={on} onCheckedChange={setOn} />
        </Label>
      </Row>
    </Specimen>
  );
}

function TabsSpecimen() {
  return (
    <Specimen title="Tabs" note="The default pill strip the wallet menu uses, and the underlined `line` variant." status="tokens">
      <Row label="default">
        <Tabs defaultValue="home" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="home">Home</TabsTrigger>
            <TabsTrigger value="reputation">Reputation</TabsTrigger>
            <TabsTrigger value="off" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="home" className="text-muted-foreground">Home panel</TabsContent>
          <TabsContent value="reputation" className="text-muted-foreground">Reputation panel</TabsContent>
        </Tabs>
      </Row>
      <Row label="line">
        <Tabs defaultValue="tokens" className="w-full">
          <TabsList variant="line">
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="tokens" className="text-muted-foreground">Token list</TabsContent>
          <TabsContent value="activity" className="text-muted-foreground">Activity list</TabsContent>
        </Tabs>
      </Row>
    </Specimen>
  );
}

function SelectSpecimen() {
  const [value, setValue] = useState<string | null>("BLEND");
  return (
    <Specimen title="Select" note="Two trigger sizes; the popup is always dark and portals into the widget root." status="tokens">
      <Row label="default">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Gas token" className="w-40">
            <SelectValue placeholder="Gas token" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Gas tokens</SelectLabel>
              <SelectItem value="ETH">ETH</SelectItem>
              <SelectItem value="BLEND">BLEND</SelectItem>
              <SelectItem value="USDnr">USDnr</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectItem value="off" disabled>
              Unavailable
            </SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="sm · placeholder">
        <Select value={null} onValueChange={() => {}}>
          <SelectTrigger size="sm" aria-label="Pick one" className="w-40">
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Option A</SelectItem>
            <SelectItem value="b">Option B</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="action menu (no value)">
        <Select value={null} onValueChange={() => {}}>
          <SelectTrigger aria-label="Address actions" className="w-44">
            <span className="font-mono">0x92b7…b8C7</span>
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectItem value="copy">
              <Copy className="size-4" />
              Copy address
            </SelectItem>
            <SelectItem value="open">
              <ExternalLink className="size-4" />
              Open on FluentScan
            </SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </Specimen>
  );
}

function TooltipSpecimen() {
  return (
    <Specimen title="Tooltip" note="Dark popup; `border-white/15` is a literal." status="mixed">
      <Row label="on a button and a help glyph">
        <Tooltip>
          <TooltipTrigger render={<Button variant="secondary" />}>Hover me</TooltipTrigger>
          <TooltipContent>Tooltips explain, they never carry actions.</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            tabIndex={0}
            aria-label="About the fee"
            render={<span className="inline-flex cursor-default rounded-sm" />}
          >
            <CircleHelp className="size-4 text-foreground/45" />
          </TooltipTrigger>
          <TooltipContent side="bottom">The paymaster charges the fee to the gas token you chose.</TooltipContent>
        </Tooltip>
      </Row>
    </Specimen>
  );
}

function FieldSpecimen() {
  const [quick, setQuick] = useState(true);
  return (
    <Specimen title="Field" note="The settings-page idiom: a label that wraps a horizontal field. `bg-white/10` is a literal." status="mixed">
      <FieldGroup className="gap-3">
        <FieldLabel htmlFor="ds-quick-sign">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Quick sign</FieldTitle>
              <FieldDescription>Sign transactions without a confirmation popup.</FieldDescription>
            </FieldContent>
            <Switch id="ds-quick-sign" checked={quick} onCheckedChange={setQuick} />
          </Field>
        </FieldLabel>
        <Field>
          <FieldLabel htmlFor="ds-recipient">Recipient</FieldLabel>
          <input
            id="ds-recipient"
            className="h-10 w-full rounded-xl bg-foreground/5 px-3 text-sm text-foreground outline-none ring-1 ring-foreground/10 placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
            placeholder="0x…"
          />
          <FieldDescription>Any address on Fluent.</FieldDescription>
        </Field>
        <Field data-invalid="true">
          <FieldLabel htmlFor="ds-amount">Amount</FieldLabel>
          <input
            id="ds-amount"
            aria-invalid
            defaultValue="1,000,000"
            className="h-10 w-full rounded-xl bg-foreground/5 px-3 text-sm text-foreground outline-none ring-1 ring-destructive/50"
          />
          <FieldError errors={[{ message: "More than your balance." }]} />
        </Field>
        <FieldSeparator>or</FieldSeparator>
        <FieldSet>
          <FieldLegend variant="label">Fee token</FieldLegend>
          <FieldDescription>Which token the paymaster charges.</FieldDescription>
        </FieldSet>
      </FieldGroup>
    </Specimen>
  );
}

function SmallBitsSpecimen() {
  return (
    <Specimen title="Label · Separator · Spinner" status="tokens">
      <Row label="label">
        <Label htmlFor="ds-label-input">Email address</Label>
        <input id="ds-label-input" className="h-8 rounded-md border border-input px-2 text-sm" placeholder="you@example.com" />
      </Row>
      <Row label="separator">
        <div className="flex w-full flex-col gap-3">
          <Separator />
          <div className="flex h-6 items-center gap-3 text-xs text-muted-foreground">
            left
            <Separator orientation="vertical" />
            right
          </div>
        </div>
      </Row>
      <Row label="spinner">
        <Spinner className="size-3" />
        <Spinner />
        <Spinner className="size-6" />
        <Spinner className="size-8 text-muted-foreground" />
      </Row>
    </Specimen>
  );
}

const TOAST_TYPES = ["success", "info", "warning", "error", "loading"] as const;

function ToastSpecimen() {
  return (
    <Specimen title="Toast" note="Bottom-right stack, one icon per type. `border-white/20` is a literal." status="mixed">
      <Row label="fire one">
        {TOAST_TYPES.map((type) => (
          <Button
            key={type}
            variant="secondary"
            size="sm"
            onClick={() =>
              toast.add({
                type,
                title: `${type[0]?.toUpperCase()}${type.slice(1)} toast`,
                description: type === "loading" ? "Waiting for the chain…" : "0x92b7…b8C7",
                timeout: type === "loading" ? 3000 : undefined,
              })
            }
          >
            {type}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            toast.add({
              type: "success",
              title: "Faucet claimed",
              description: "BLEND was sent to your wallet.",
              actionProps: { children: "View", onClick: () => {} },
            })
          }
        >
          with action
        </Button>
      </Row>
    </Specimen>
  );
}

function DialogSpecimen() {
  return (
    <Specimen title="Dialog" note="The generic popup: header, body, footer. Opens in the widget's top layer." status="tokens">
      <Row label="open live">
        <Dialog>
          <DialogTrigger render={<Button variant="secondary" />}>Open dialog</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove PRV?</DialogTitle>
              <DialogDescription>
                The token leaves your list. Its balance stays where it is and the token can be
                added again by address.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter showCloseButton>
              <Button variant="destructive">Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
    </Specimen>
  );
}

function DrawerSpecimen() {
  return (
    <Specimen title="Drawer" note="Slides in from the right on desktop, up from the bottom on mobile; modal, swipe to dismiss." status="tokens">
      <Row label="open live">
        <Drawer swipeDirection="right">
          <DrawerTrigger render={<Button variant="secondary" />}>Open drawer</DrawerTrigger>
          <DrawerContent aria-label="Example drawer" className="dark text-foreground antialiased sm:w-96">
            <DrawerHeader>
              <DrawerTitle>Example drawer</DrawerTitle>
              <DrawerDescription>The shell the account menu lives in.</DrawerDescription>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto p-4 text-sm text-muted-foreground">
              Swipe right, press Escape or click outside to close.
            </div>
            <DrawerFooter>
              <DrawerClose render={<Button variant="secondary" />}>Close</DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Row>
    </Specimen>
  );
}

export function PrimitivesSection() {
  return (
    <Section
      id="primitives"
      title="Primitives"
      note={
        <>
          The shadcn-style building blocks in <code>packages/connect/src/components/ui/</code>, on
          Base UI. Everything the widget composes from.
        </>
      }
    >
      <SpecimenGrid>
        <ButtonSpecimen />
        <SwitchSpecimen />
        <TabsSpecimen />
        <SelectSpecimen />
        <TooltipSpecimen />
        <FieldSpecimen />
        <SmallBitsSpecimen />
        <ToastSpecimen />
        <DialogSpecimen />
        <DrawerSpecimen />
      </SpecimenGrid>
    </Section>
  );
}
