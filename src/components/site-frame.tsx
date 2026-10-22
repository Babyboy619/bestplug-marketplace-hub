import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Package,
  ReceiptText,
  ShieldCheck,
  Settings,
  ShoppingBag,
  Sun,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/bestplug-logo.jpg.asset.json";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/hooks/use-auth-user";
import { supabase } from "@/integrations/supabase/client";

type MenuItem = {
  to:
    | "/"
    | "/how-it-works"
    | "/products"
    | "/wallet"
    | "/account-settings"
    | "/contact"
    | "/admin"
    | "/notifications";
  hash?: "#orders" | "#transactions";
  label: string;
  icon: LucideIcon;
};

const menuSections: { title: string; items: MenuItem[] }[] = [
  {
    title: "General",
    items: [
      { to: "/", label: "Dashboard", icon: Home },
      { to: "/how-it-works", label: "How It Works", icon: BookOpen },
    ],
  },
  {
    title: "Shopping",
    items: [{ to: "/products", label: "Buy Account", icon: ShoppingBag }],
  },
  {
    title: "Activity",
    items: [
      { to: "/wallet", hash: "#orders", label: "My Orders", icon: Box },
      { to: "/wallet", hash: "#transactions", label: "Transaction History", icon: ReceiptText },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/wallet", label: "Fund Wallet", icon: Wallet },
      { to: "/account-settings", label: "Account Settings", icon: Settings },
    ],
  },
  {
    title: "Additional",
    items: [{ to: "/contact", label: "Contact Us", icon: MessageCircle }],
  },
];

const bottomItems = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/products", label: "Buy Acc.", icon: ShoppingBag, exact: false },
  { to: "/wallet", label: "Fund", icon: Wallet, exact: false },
  { to: "/wallet", hash: "#orders", label: "Orders", icon: Package, exact: false },
] as const;

export function SiteFrame({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin } = useAuthUser();
  const { pathname, hash } = useRouterState({
    select: (state) => ({ pathname: state.location.pathname, hash: state.location.hash }),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState<number | null>(null);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("bestplug-theme");
    const dark = storedTheme ? storedTheme === "dark" : true;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  useEffect(() => {
    if (!user) {
      setUnreadNotifications(0);
      return;
    }
    let active = true;
    const refreshUnread = () => {
      void supabase.rpc("count_unread_notifications").then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Unread notification count could not be loaded:", error);
          setUnreadNotifications(null);
        } else {
          setUnreadNotifications(Number(data ?? 0));
        }
      });
    };
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 60000);
    window.addEventListener("bestplug-notification-read", refreshUnread);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("bestplug-notification-read", refreshUnread);
    };
  }, [user]);

  function toggleTheme() {
    const nextDark = !isDark;
    setIsDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    window.localStorage.setItem("bestplug-theme", nextDark ? "dark" : "light");
  }

  return (
    <div className="site-shell min-h-screen bg-background text-foreground">
      <header className="lux-header">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open main menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="size-10 shrink-0"
          >
            <Menu />
          </Button>
          <Link to="/" aria-label="BESTPLUG dashboard" className="flex min-w-0 items-center gap-2">
            <img
              src={logo.url}
              alt="BestPlug logo"
              className="size-9 shrink-0 rounded-full object-cover"
            />
            <span className="brand-title hidden text-xs font-bold leading-tight min-[360px]:block sm:text-sm">
              BESTPLUG
              <span className="block text-[9px] font-semibold text-primary">MARKETPLACE</span>
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Quick navigation">
            <Link
              to="/"
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              to="/products"
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Buy Account
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                Admin Dashboard
              </Link>
            )}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 md:ml-3">
            <span
              aria-label="Currency: Nigerian naira"
              className="rounded-md border border-border px-2 py-1.5 text-[11px] font-bold text-muted-foreground sm:px-2.5 sm:text-xs"
            >
              NGN
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
              onClick={toggleTheme}
            >
              {isDark ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" className="relative size-9" asChild>
              <Link
                to="/notifications"
                aria-label={
                  unreadNotifications === null
                    ? "Notifications"
                    : `${unreadNotifications} unread notifications`
                }
              >
                <Bell />
                {unreadNotifications !== null && unreadNotifications > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-[70] flex bg-slate-950/60 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Close main menu"
            className="absolute inset-0 size-full cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation menu"
            className="relative z-10 flex h-full w-[57vw] min-w-[180px] max-w-[320px] flex-col overflow-y-auto bg-[#101a31] px-3 pb-6 pt-[max(1rem,env(safe-area-inset-top))] text-slate-100 shadow-2xl sm:px-5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-300">Menu</p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close menu"
                className="size-9 text-slate-300 hover:bg-white/10 hover:text-white"
                onClick={() => setMenuOpen(false)}
              >
                <X />
              </Button>
            </div>
            <nav className="mt-4 space-y-5" aria-label="Main menu">
              {menuSections.map((section) => (
                <section key={section.title}>
                  <h2 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    {section.title}
                  </h2>
                  <div className="space-y-1">
                    {section.items.map(({ to, hash, label, icon: Icon }) => (
                      <Link
                        key={`${to}-${label}`}
                        to={to}
                        {...(hash ? { hash } : {})}
                        activeOptions={{ exact: to === "/" && !hash }}
                        activeProps={{ className: "!bg-orange-500 !text-white" }}
                        className="flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                        onClick={() => setMenuOpen(false)}
                      >
                        <Icon aria-hidden="true" className="size-[18px] shrink-0 text-orange-300" />
                        <span className="min-w-0">{label}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
              {isAdmin && (
                <section>
                  <h2 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Administration
                  </h2>
                  <Link
                    to="/admin"
                    className="flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                    onClick={() => setMenuOpen(false)}
                  >
                    <ShieldCheck
                      aria-hidden="true"
                      className="size-[18px] shrink-0 text-orange-300"
                    />
                    <span>Admin Dashboard</span>
                  </Link>
                </section>
              )}
            </nav>
          </aside>
        </div>
      )}

      <nav
        aria-label="Primary mobile navigation"
        className={`lux-dock${isAdmin ? " lux-dock-admin" : ""} md:hidden`}
      >
        {(isAdmin
          ? [...bottomItems, { to: "/admin", label: "Admin", icon: ShieldCheck, exact: true }]
          : bottomItems
        ).map((item) => {
          const { to, label, icon: Icon, exact } = item;
          const itemHash = "hash" in item ? item.hash : undefined;
          const isActive =
            pathname === to
              ? itemHash
                ? itemHash === hash
                : to === "/wallet"
                  ? !hash
                  : true
              : !exact && pathname.startsWith(`${to}/`);
          return (
            <Link
              key={`${to}-${label}`}
              to={to}
              {...(itemHash ? { hash: itemHash } : {})}
              activeOptions={{ exact }}
              aria-current={isActive ? "page" : undefined}
              className={`lux-dock-item${isActive ? " lux-dock-active" : ""}`}
            >
              <Icon aria-hidden="true" className="size-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="site-content">{children}</div>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8">
          <div>
            <p className="brand-title font-bold">
              BESTPLUG <span className="text-primary">MARKETPLACE</span>
            </p>
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
              Your plug for social media accounts. Find your platform. Make your next move.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold">Marketplace</p>
            <Link className="mt-3 block text-sm text-muted-foreground" to="/products">
              Browse accounts
            </Link>
            <Link className="mt-3 block text-sm text-muted-foreground" to="/wallet">
              Wallet & orders
            </Link>
            <Link className="mt-3 block text-sm text-muted-foreground" to="/contact">
              Contact
            </Link>
          </div>
          <div>
            <p className="text-sm font-semibold">Your account</p>
            {loading ? (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Checking your session…
              </p>
            ) : user ? (
              <>
                <Link className="mt-3 block text-sm text-muted-foreground" to="/account-settings">
                  Account Settings
                </Link>
                <Link className="mt-3 block text-sm text-muted-foreground" to="/wallet">
                  Wallet and orders
                </Link>
                {isAdmin && (
                  <Link className="mt-3 block text-sm text-muted-foreground" to="/admin">
                    Admin Dashboard
                  </Link>
                )}
                <Button
                  variant="link"
                  className="mt-3 h-auto p-0 text-sm text-muted-foreground"
                  onClick={() => void supabase.auth.signOut()}
                >
                  <LogOut aria-hidden="true" className="size-4" /> Log out
                </Button>
              </>
            ) : (
              <>
                <Link className="mt-3 block text-sm text-muted-foreground" to="/auth">
                  Sign in
                </Link>
                <Link
                  className="mt-3 block text-sm text-muted-foreground"
                  to="/auth"
                  search={{ mode: "signup" }}
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="border-t border-border px-4 py-5 text-center text-xs text-muted-foreground">
          © 2026 BESTPLUG MARKETPLACE. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
