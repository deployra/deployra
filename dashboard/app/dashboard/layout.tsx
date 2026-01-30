'use client';

import { DashboardProvider } from "@/contexts/dashboard";

interface DashboardRootLayoutProps {
  children: React.ReactNode;
}

export default function DashboardRootLayout({ children }: DashboardRootLayoutProps) {
  return (
    <DashboardProvider>
      {children}
    </DashboardProvider>
  );
}
