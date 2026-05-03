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
          <header className="flex items-center justify-between px-6 py-3.5 border-b">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tracking-tight">AgentMesh</span>
              <span className="hidden sm:block text-xs text-muted-foreground">decentralized agent runtime</span>
            </div>
            <ModeToggle />
          </header>
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
