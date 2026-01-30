'use client';

import React from 'react';
import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useDashboard } from "@/contexts/dashboard";
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { 
    loading, 
    error, 
    activeOrganization,
    activeProject,
    activeService,
  } = useDashboard();
  const pathname = usePathname();

  const getBreadcrumbItems = () => {
    const segments = pathname.split('/').filter(Boolean);
    const items = [];
    
    // Add dashboard
    items.push({
      href: '/dashboard',
      label: 'Dashboard'
    });
    
    // Check URL pattern to determine if we're in a project or service page
    if (segments.includes('projects') && activeProject) {
      
      // Add current project
      items.push({
        href: `/dashboard/${activeOrganization?.id}/projects/${activeProject.id}`,
        label: activeProject.name
      });
      
      // Check if we're in a service page
      if (segments.includes('services') && activeService) {        
        // Add current service
        items.push({
          href: `/dashboard/${activeOrganization?.id}/projects/${activeProject.id}/services/${activeService.id}`,
          label: activeService.name
        });
      }
    }

    return items;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                {getBreadcrumbItems().map((item, index) => (
                  <React.Fragment key={index}>
                    <BreadcrumbItem>
                      <Link href={item.href}>{item.label}</Link>
                    </BreadcrumbItem>
                    {index < getBreadcrumbItems().length - 1 && (
                      <BreadcrumbSeparator>
                        <ChevronRight className="h-4 w-4" />
                      </BreadcrumbSeparator>
                    )}
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}