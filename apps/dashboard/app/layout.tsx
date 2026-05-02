import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "../components/theme-provider";
import { ModeToggle } from "../components/mode-toggle";

export const metadata: Metadata = {
  title: "AgentMesh",
  description: "Decentralized AI Agent Runtime",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
        >
          <header className="flex items-center justify-between px-6 py-4 border-b">
            <div className="text-lg font-bold tracking-tight">AgentMesh</div>
            <ModeToggle />
          </header>
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
