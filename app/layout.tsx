import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Referrals",
  description: "Referral tracking.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* A skip link is the cheapest real accessibility win there is, and it only works
            if it exists before anything else focusable. */}
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-3 focus:rounded focus:bg-black focus:px-3 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
