import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "@/components/settings-nav";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";

const sidebarNavItems = [
  {
    title: "Settings",
    href: "/account/settings",
  },
  {
    title: "API Keys",
    href: "/account/api-keys",
  },
];

interface AccountLayoutProps {
  children: React.ReactNode;
}

export default function AccountLayout({ children }: AccountLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1 mx-auto max-w-screen-lg w-full">
        <div className="space-y-6 p-6 md:p-8">
          <div className="flex justify-between items-center">
            <div className="space-y-0.5">
              <h2 className="text-2xl font-bold tracking-tight">Account Settings</h2>
              <p className="text-muted-foreground">
                Manage your account settings, security, and preferences.
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="outline">Go to Dashboard</Button>
            </Link>
          </div>
          <Separator />
          <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
            <aside className="lg:w-1/4 mb-4">
              <SidebarNav items={sidebarNavItems} />
            </aside>
            <div className="flex-1">{children}</div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
