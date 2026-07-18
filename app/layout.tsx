import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Node Canvas — Geonju Kim",
  description:
    "A Grasshopper-inspired interactive portfolio canvas prototype by Geonju Kim.",
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
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
