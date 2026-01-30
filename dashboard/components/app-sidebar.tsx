"use client"

import * as React from "react"
import {
  Bot,
  FolderArchive,
  GitBranch,
  Settings2,
  Activity,
  LayersIcon,
  Cpu,
  Rocket,
  Database,
  BarChart,
  Clock,
  ScrollText,
  Github,
} from "lucide-react"

const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 3h16c.6 0 1 .4 1 1v16c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1zm9.5 10.2l4.2-6.2H16l-3.2 4.8L10 7h-1.7l4.3 6.5-4.3 6.5H9l3.3-4.9 3.4 4.9h1.6l-4.3-6.3z" />
  </svg>
)
import { usePathname } from "next/navigation"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { OrganizationSwitcher } from "@/components/org-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useDashboard } from "@/contexts/dashboard"

type AppSidebarProps = React.ComponentProps<typeof Sidebar>;

export function AppSidebar({ ...props }: AppSidebarProps) {
  const { user, activeOrganizationId, activeService, loadingServices } = useDashboard();
  const displayName = user 
    ? user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName}`
      : user.email
    : '';
  
  const pathname = usePathname();
  
  // Check if we're on a service detail page by matching the URL pattern
  const servicePagePattern = /\/dashboard\/[^/]+\/projects\/[^/]+\/services\/[^/]+(?:\/[^/]+)?/;
  const isServicePage = servicePagePattern.test(pathname);

  const projectPagePattern = /\/dashboard\/[^/]+\/projects\/[^/]+(?:\/[^/]+)?/;
  const isProjectPage = projectPagePattern.test(pathname);
  
  // Extract organizationId, projectId, and serviceId from the URL if on a service page
  let organizationId = '';
  let projectId = '';
  let serviceId = '';
  
  if (isServicePage) {
    const pathSegments = pathname.split('/');
    organizationId = pathSegments[2]; // dashboard/[organizationId]
    projectId = pathSegments[4];      // projects/[projectId]
    serviceId = pathSegments[6];      // services/[serviceId]
  }

  if (isProjectPage) {
    const pathSegments = pathname.split('/');
    organizationId = pathSegments[2]; // dashboard/[organizationId]
    projectId = pathSegments[4];      // projects/[projectId]
  }
  
  // Define the navigation items based on the current page and service type
  const navItems = React.useMemo(() => {
    // Common navigation items that appear on all pages
    const commonItems = [
      {
        title: "Settings",
        items: [
          {
            title: "Git",
            url: `/dashboard/${activeOrganizationId}/settings/git-providers`,
            icon: GitBranch,
          },
        ]
      },
      {
        title: "Links",
        items: [
          {
            title: "GitHub",
            url: "https://github.com/deployra",
            icon: Github,
            external: true,
          },
          {
            title: "X",
            url: "https://x.com/deployracom",
            icon: XIcon,
            external: true,
          },
        ]
      }
    ];

    if (isProjectPage && !isServicePage) {
      // Project detail specific navigation
      return [
        {
          title: "Platform",
          items: [
            {
              title: "Projects",
              url: `/dashboard/${activeOrganizationId}`,
              icon: FolderArchive,
            },
            {
              title: "Services",
              url: `/dashboard/${activeOrganizationId}/projects/${projectId}`,
              icon: Cpu,
            },
          ]
        },
        {
          title: "Project",
          items: [
            {
              title: "Settings",
              url: `/dashboard/${activeOrganizationId}/projects/${projectId}/settings`,
              icon: Settings2,
            },
          ]
        },
        ...commonItems
      ];
    }

    if (isServicePage) {
      // Service detail specific navigation based on service type
      if (activeService && activeService.serviceTypeId === "mysql") {
        // MySQL specific navigation
        return [
          {
            title: "Platform",
            items: [
              {
                title: "Projects",
                url: `/dashboard/${activeOrganizationId}`,
                icon: FolderArchive,
              },
              {
                title: "Services",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}`,
                icon: Cpu,
              },
            ]
          },
          {
            title: "Database",
            items: [
              {
                title: "Overview",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}`,
                icon: Database,
              },
              {
                title: "Metrics",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/metrics`,
                icon: BarChart,
              },
              {
                title: "Logs",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/logs`,
                icon: ScrollText,
              },
              {
                title: "Settings",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/settings`,
                icon: Settings2,
              },
            ]
          },
          ...commonItems
        ];
      } else if (activeService && activeService.serviceTypeId === "postgresql") {
        // Postgres specific navigation
        return [
          {
            title: "Platform",
            items: [
              {
                title: "Projects",
                url: `/dashboard/${activeOrganizationId}`,
                icon: FolderArchive,
              },
              {
                title: "Services",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}`,
                icon: Cpu,
              },
            ]
          },
          {
            title: "Database",
            items: [
              {
                title: "Overview",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}`,
                icon: Database,
              },
              {
                title: "Metrics",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/metrics`,
                icon: BarChart,
              },
              {
                title: "Logs",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/logs`,
                icon: ScrollText,
              },
              {
                title: "Settings",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/settings`,
                icon: Settings2,
              },
            ]
          },
          ...commonItems
        ];
      } else if (activeService && activeService.serviceTypeId === "memory") {
        // Memory specific navigation
        return [
          {
            title: "Platform",
            items: [
              {
                title: "Projects",
                url: `/dashboard/${activeOrganizationId}`,
                icon: FolderArchive,
              },
              {
                title: "Services",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}`,
                icon: Cpu,
              },
            ]
          },
          {
            title: "Memory",
            items: [
              {
                title: "Overview",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}`,
                icon: Database,
              },
              {
                title: "Metrics",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/metrics`,
                icon: BarChart,
              },
              {
                title: "Logs",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/logs`,
                icon: ScrollText,
              },
              {
                title: "Settings",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/settings`,
                icon: Settings2,
              },
            ]
          },
          ...commonItems
        ];
      } else if (activeService && (activeService.serviceTypeId === "web" || activeService.serviceTypeId === "private")) {
        // Default navigation for web and private service types
        return [
          {
            title: "Platform",
            items: [
              {
                title: "Projects",
                url: `/dashboard/${activeOrganizationId}`,
                icon: FolderArchive,
              },
              {
                title: "Services",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}`,
                icon: Cpu,
              },
            ]
          },
          {
            title: "Service",
            items: [
              {
                title: "Events",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}`,
                icon: Activity,
              },
              {
                title: "Deploys",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/deploys`,
                icon: Rocket,
              },
              {
                title: "Metrics",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/metrics`,
                icon: BarChart,
              },
              {
                title: "Logs",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/logs`,
                icon: ScrollText,
              },
              {
                title: "Scaling",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/scaling`,
                icon: Cpu,
              },
              {
                title: "Environment",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/environment`,
                icon: LayersIcon,
              },
              {
                title: "CronJobs",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/cronjobs`,
                icon: Clock,
              },
              {
                title: "Settings",
                url: `/dashboard/${activeOrganizationId}/projects/${projectId}/services/${serviceId}/settings`,
                icon: Settings2,
              },
            ]
          },
          ...commonItems
        ];
      } else {
        return [
          {
            title: "Platform",
            items: [
              {
                title: "Projects",
                url: `/dashboard/${activeOrganizationId}`,
                icon: FolderArchive,
              }
            ]
          },
          ...commonItems
        ];
      }
    } else {
      // Default navigation for other pages
      return [
        {
          title: "Platform",
          items: [
            {
              title: "Projects",
              url: `/dashboard/${activeOrganizationId}`,
              icon: FolderArchive,
            }
          ]
        },
        ...commonItems
      ];
    }
  }, [pathname, organizationId, projectId, serviceId, activeOrganizationId, activeService]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {<NavMain items={navItems} />}
      </SidebarContent>
      <SidebarFooter>
        {user ? (
          <NavUser user={{
            name: displayName,
            email: user.email,
            avatar: `/avatars/default.png`
          }} />
        ) : (
          <div className="px-2 py-2">
            <div className="animate-pulse h-8 bg-gray-200 rounded-md" />
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
