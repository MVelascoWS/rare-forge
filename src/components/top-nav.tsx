"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/use-identity";
import { ConnectWallet } from "./connect-wallet";

/**
 * Persistent top nav shown AFTER connecting (FRONTEND_SPEC screen 0). Links to
 * the two entry views; navigation is open regardless of the onboarding role.
 * Renders nothing until a wallet is connected so the onboarding screen stays clean.
 */
const LINKS = [
  { href: "/works", label: "Works" },
  { href: "/artist", label: "Artist" },
];

export function TopNav() {
  const { isConnected } = useIdentity();
  const pathname = usePathname();

  if (!isConnected) return null;

  return (
    <header className="sticky top-0 z-10 border-b border-[color:var(--border-subtle)] bg-glass backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/works" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="h-6 w-6" />
            <span className="font-display text-lg text-t1">Rare Forge</span>
          </Link>
          <div className="flex items-center gap-1">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface-raised text-t1"
                      : "text-t3 hover:text-t1"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
        <ConnectWallet />
      </nav>
    </header>
  );
}
