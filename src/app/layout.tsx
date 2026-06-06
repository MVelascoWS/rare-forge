import type { Metadata } from "next";
import "./globals.css";
// Design system loads AFTER globals.css so its base.css (plum canvas, serif
// headings, .rf-* utilities) wins over Tailwind's preflight reset.
import "../styles/design-system/styles.css";
import { Providers } from "./providers";
import { TopNav } from "@/components/top-nav";


export const metadata: Metadata = {
  title: "Rare Forge",
  description:
    "Collaborative creative pipeline with on-chain authorship and fair royalty splits — Rare Protocol x ETHMexico.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TopNav />
          <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
