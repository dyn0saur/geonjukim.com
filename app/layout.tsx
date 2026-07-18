import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HANA HQ — Geonju Kim",
  description:
    "HANA HQ fabrication workflow on a Grasshopper-inspired interactive portfolio canvas by Geonju Kim.",
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
