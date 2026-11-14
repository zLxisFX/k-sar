import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "K-SAR · Research workspace",
  description: "Research scaffold for radar observations, flood scenarios and road-network analysis in the Marikina–Pasig basin.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
