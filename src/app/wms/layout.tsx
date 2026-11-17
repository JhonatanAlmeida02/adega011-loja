import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "WMS", template: "%s · WMS" },
  robots: { index: false, follow: false },
};

export default function WmsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
