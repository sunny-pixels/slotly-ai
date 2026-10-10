"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  BookOpenText,
  CalendarCheck2,
  ChevronsUpDown,
  Compass,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  Repeat2,
  Sparkles,
  Tags,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SheetContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/menu";
import { continueAsAction, signOutAction } from "@/app/actions/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { AccountPicker } from "./account-picker";
import { DemoAccountHint } from "@/components/onboarding/demo-account-hint";
import { openTour } from "@/lib/use-local-flag";
import { Logo } from "./logo";

export type ShellUser = { name: string; email: string; role: "CUSTOMER" | "ADMIN" } | null;

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean };

const customerNav: NavItem[] = [
  { href: "/", label: "Services", icon: LayoutGrid, exact: true },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  { href: "/bookings", label: "My bookings", icon: CalendarCheck2 },
];

const adminNav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/admin/availability", label: "Availability", icon: CalendarClock },
  { href: "/admin/services", label: "Services", icon: Tags },
  { href: "/admin/knowledge-base", label: "Knowledge base", icon: BookOpenText },
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href || (item.href === "/" && pathname.startsWith("/services"));
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({ user, onNavigate, compact = false }: { user: ShellUser; onNavigate?: () => void; compact?: boolean }) {
  const pathname = usePathname();
  const renderItem = (item: NavItem) => {
    const active = isActive(pathname, item);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          title={compact ? item.label : undefined}
          className={cn(
            "group flex h-9 items-center gap-3 rounded-md px-2.5 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-canvas-sunken hover:text-ink",
            active && "bg-accent-faint text-brand hover:bg-accent-faint hover:text-brand",
            compact && "justify-center px-0 xl:justify-start xl:px-2.5",
          )}
        >
          <Icon className={cn("size-4.5 shrink-0", active ? "text-brand" : "text-ink-subtle group-hover:text-ink-muted")} />
          <span className={cn(compact && "sr-only xl:not-sr-only")}>{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <ul className="flex flex-col gap-0.5">{customerNav.map(renderItem)}</ul>
      {user?.role === "ADMIN" && (
        <div className="flex flex-col gap-1.5">
          <p className={cn("px-2.5 text-label font-semibold uppercase text-ink-subtle", compact && "sr-only xl:not-sr-only")}>Studio admin</p>
          <ul className="flex flex-col gap-0.5">{adminNav.map(renderItem)}</ul>
        </div>
      )}
    </nav>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((p) => /^[A-Za-z]/.test(p))
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function UserMenu({ user, compact = false }: { user: ShellUser; compact?: boolean }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const run = (action: (fd: FormData) => Promise<void>, fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(() => action(fd));
  };
  if (!user) {
    return (
      <Popover>
        <PopoverTrigger
          className={cn(
            "flex w-full items-center gap-3 rounded-lg bg-brand p-2 text-left text-white shadow-xs transition-colors hover:bg-brand-hover data-[state=open]:bg-brand-strong",
            compact && "justify-center xl:justify-start",
          )}
        >
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-brand-strong">
            <LogIn className="size-4" />
          </span>
          <span className={cn("min-w-0 flex-1", compact && "sr-only xl:not-sr-only")}>
            <span className="block text-[0.8125rem] font-semibold">Continue as…</span>
            <span className="block truncate text-[0.75rem] text-white/70">Choose a demo account</span>
          </span>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-80">
          <p className="mb-3 px-1 text-meta text-ink-muted">Demo accounts — no password needed.</p>
          <AccountPicker compact />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg bg-brand p-2 text-left text-white shadow-xs transition-colors hover:bg-brand-hover data-[state=open]:bg-brand-strong",
          compact && "justify-center xl:justify-start",
        )}
      >
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[0.75rem] font-bold text-brand-strong">
          {initials(user.name) || <UserRound className="size-4" />}
        </span>
        <span className={cn("min-w-0 flex-1", compact && "sr-only xl:not-sr-only")}>
          <span className="block truncate text-[0.8125rem] font-semibold">{user.name}</span>
          <span className="block truncate text-[0.75rem] text-white/70">{user.role === "ADMIN" ? "Administrator" : user.email}</span>
        </span>
        <ChevronsUpDown className={cn("size-4 shrink-0 text-white/60", compact && "hidden xl:block")} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>
          Signed in as
          <span className="block truncate font-medium text-ink">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/bookings">
            <CalendarCheck2 /> My bookings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Switch demo account</DropdownMenuLabel>
        {/* Menu items unmount on select, so actions are invoked directly rather than via nested <form>s. */}
        {DEMO_ACCOUNTS.filter((a) => a.name !== user.name).map((a) => (
          <DropdownMenuItem
            key={a.key}
            disabled={pending}
            onSelect={() =>
              run(continueAsAction, {
                account: a.key,
                callbackUrl: a.role === "ADMIN" ? "/admin" : pathname.startsWith("/admin") ? "/" : pathname,
              })
            }
          >
            <Repeat2 /> {a.name}
            <span className="ml-auto text-[0.6875rem] uppercase text-ink-subtle">{a.role === "ADMIN" ? "Admin" : "Customer"}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={() => run(signOutAction, { callbackUrl: "/" })}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Re-opens the welcome tour. */
function TourLink({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={openTour}
      title={compact ? "Product tour" : undefined}
      className={cn(
        "group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-canvas-sunken hover:text-ink",
        compact && "justify-center px-0 xl:justify-start xl:px-2.5",
      )}
    >
      <Compass className="size-4.5 shrink-0 text-ink-subtle group-hover:text-ink-muted" />
      <span className={cn(compact && "sr-only xl:not-sr-only")}>Product tour</span>
    </button>
  );
}

/** Desktop/tablet sidebar: icon rail at md–lg, full labels from xl. */
export function Sidebar({ user }: { user: ShellUser }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-(--sidebar-rail) shrink-0 flex-col border-r border-line bg-surface md:flex xl:w-(--sidebar-width)">
      <div className="flex h-(--topbar-height) items-center justify-center border-b border-line px-4 xl:justify-start">
        <Link href="/" aria-label="Slotly AI home" className="rounded-md">
          <span className="xl:hidden">
            <Logo collapsed />
          </span>
          <span className="hidden xl:block">
            <Logo />
          </span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <NavLinks user={user} compact />
      </div>
      <div className="px-3 pb-2">
        <TourLink compact />
      </div>
      <div className="border-t border-line p-3">
        <div className="hidden xl:block">
          <DemoAccountHint signedIn={Boolean(user)} />
        </div>
        <UserMenu user={user} compact />
      </div>
    </aside>
  );
}

/** Mobile top bar with a slide-in navigation sheet. */
export function MobileNav({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur-sm md:hidden">
      <Link href="/" aria-label="Slotly AI home">
        <Logo />
      </Link>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger className="flex size-9 items-center justify-center rounded-md text-ink hover:bg-canvas-sunken" aria-label="Open navigation">
          <Menu className="size-5" />
        </DialogPrimitive.Trigger>
        <SheetContent side="left" className="w-[min(85vw,18rem)]">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Main sections of Slotly</DialogPrimitive.Description>
          <div className="flex h-14 items-center border-b border-line px-4">
            <Logo />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-5">
            <NavLinks user={user} onNavigate={() => setOpen(false)} />
          </div>
          <div className="px-3 pb-2" onClick={() => setOpen(false)}>
            <TourLink />
          </div>
          <div className="border-t border-line p-3">
            <DemoAccountHint signedIn={Boolean(user)} />
            <UserMenu user={user} />
          </div>
        </SheetContent>
      </DialogPrimitive.Root>
    </div>
  );
}
