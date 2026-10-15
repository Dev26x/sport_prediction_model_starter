import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Matchday — NBA & Premier League",
  description: "Your private NBA and Premier League research dashboard. Fixtures, model probabilities, market comparisons and editable research slips.",
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
