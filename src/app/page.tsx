"use client";

import Link from "next/link";
import { useIdentity } from "@/lib/use-identity";
import { ConnectWallet } from "@/components/connect-wallet";

/**
 * Onboarding / Connect (FRONTEND_SPEC screen 0) — the one full-brand moment:
 * aurora wash, display-serif headline with prism-text words, prism-edge role
 * cards. Logic unchanged: connect → choose a starting view (open navigation).
 */
export default function OnboardingPage() {
  const { isConnected } = useIdentity();

  return (
    <div className="rf-aurora -mx-6 -mt-8 rounded-b-2xl px-6 pb-20 pt-24">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <span className="rf-eyebrow mb-6">Rare Protocol × ETHMexico</span>

        <h1 className="rf-display text-4xl sm:text-5xl">
          Build <span className="rf-prism-text">together</span>, split{" "}
          <span className="rf-prism-text">fairly</span>.
        </h1>

        <p className="mt-5 max-w-xl text-md text-t3">
          A production line for collaborative creative works. Every asset is
          recorded on-chain with its author, and when the finished work sells
          copies, royalties split automatically and fairly among everyone who
          built it.
        </p>

        {!isConnected ? (
          <div className="mt-10 flex flex-col items-center gap-3">
            <ConnectWallet size="lg" />
            <p className="text-xs text-t4">
              Your wallet only identifies you. The backend signs all on-chain
              transactions.
            </p>
          </div>
        ) : (
          <div className="mt-10 w-full">
            <p className="mb-4 text-sm text-t3">
              Connected. How do you want to start?
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <RoleCard
                href="/works"
                title="I'm a Producer"
                desc="Create a work, open bounties, review deliveries, and seal it for sale."
              />
              <RoleCard
                href="/artist"
                title="I'm an Artist"
                desc="Browse open bounties, claim one, deliver your asset, and get paid."
              />
            </div>
            <p className="mt-4 text-xs text-t4">
              This only sets your starting view — you can switch anytime from the
              top nav.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-card p-5 text-left shadow-card transition-shadow hover:shadow-glow-prism"
    >
      {/* subtle prism edge revealed on hover */}
      <span className="rf-prism-rule absolute inset-x-0 top-0 opacity-0 transition-opacity group-hover:opacity-100" />
      <h2 className="rf-display text-lg text-t1">{title}</h2>
      <p className="mt-1.5 text-sm text-t3">{desc}</p>
      <span className="mt-4 inline-block text-sm font-medium text-accent">
        Continue →
      </span>
    </Link>
  );
}
