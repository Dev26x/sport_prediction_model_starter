import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matchday — Multi-Sport Models",
  description: "Your private NBA, NFL, NHL, EPL, La Liga and Serie A research dashboard. Fixtures, model probabilities, market comparisons and editable research slips.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
