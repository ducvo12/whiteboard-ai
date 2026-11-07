import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "tldraw/tldraw.css";
import "katex/dist/katex.min.css";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Whiteboard AI",
  description: "An interactive whiteboard with an AI assistant for drawing, diagrams, and explanations.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geist.className}>
      <body>{children}</body>
    </html>
  );
}
