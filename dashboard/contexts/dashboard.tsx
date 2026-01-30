'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  getToken, 
  getUser, 
  getOrganizations, 
  getProjects, 
  getServices, 
  removeToken 
} from '@/lib/api';
import { User, Organization, Project, Service } from '@/lib/models'

interface DashboardContextType {
  // Auth related
  loading: boolean;
  user: User | null;
  organizations: Organization[];
  error: string | null;
  logout: () => void;
  refreshData: () => Promise<void>;
  
  // Organization related
  activeOrganizationId: string | null;
  setActiveOrganizationId: (id: string | null) => void;
  activeOrganization: Organization | null;
  
  // Project related
  projects: Project[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeProject: Project | null;
  loadingProjects: boolean;
  
  // Service related
  services: Service[];
  activeServiceId: string | null;
  setActiveServiceId: (id: string | null) => void;
  activeService: Service | null;
  loadingServices: boolean;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export function DashboardProvider({ 
  children 
}: { 
  children: React.ReactNode;
}) {
  const router = useRouter();
  const params = useParams();
  
  // Auth states
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Organization states
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(null);
  
  // Project states
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  
  // Service states
  const [services, setServices] = useState<Service[]>([]);
  const [activeServiceId, setActiveServiceIdState] = useState<string | null>(null);
  const [loadingServices, setLoadingServices] = useState(false);

  // Set initial active organization from URL params or first organization
  useEffect(() => {
    if (organizations.length > 0) {
      const orgIdFromParams = params?.organizationId as string;
      if (orgIdFromParams && organizations.some(org => org.id === orgIdFromParams)) {
        // Only set if the organization exists in the loaded organizations
        setActiveOrganizationIdState(orgIdFromParams);
      } else if (!activeOrganizationId || !organizations.some(org => org.id === activeOrganizationId)) {
        // Set to the first organization if the active one is null or invalid
        setActiveOrganizationIdState(organizations[0]?.id || null);
        
        /*
        // Redirect to the first organization if we're at the root dashboard page
        if (window.location.pathname === '/dashboard' && organizations[0]?.id) {
          router.replace(`/dashboard/${organizations[0].id}`, { scroll: false });
        }
        */
      }
    }
  }, [organizations, params?.organizationId, activeOrganizationId]);
  
  // Handle organization change with navigation
  const setActiveOrganizationId = (id: string | null) => {
    setActiveOrganizationIdState(id);
    // Only navigate if we have a valid organization ID
    if (id) {
      router.replace(`/dashboard/${id}`, { scroll: false });
    }
  };
  
  // Get active organization object
  const activeOrganization = activeOrganizationId 
    ? organizations.find(org => org.id === activeOrganizationId) || null
    : null;
    
  // Set active project ID with navigation if needed
  const setActiveProjectId = (id: string | null) => {
    setActiveProjectIdState(id);
    if (id && activeOrganizationId) {
      router.replace(`/dashboard/${activeOrganizationId}/projects/${id}`, { scroll: false });
    }
  };
  
  // Get active project object
  const activeProject = activeProjectId
    ? projects.find(project => project.id === activeProjectId) || null
    : null;
    
  // Set active service ID with navigation if needed  
  const setActiveServiceId = (id: string | null) => {
    setActiveServiceIdState(id);
    if (id && activeOrganizationId && activeProjectId) {
      router.replace(`/dashboard/${activeOrganizationId}/projects/${activeProjectId}/services/${id}`, { scroll: false });
    }
  };
  
  // Get active service object
  const activeService = activeServiceId
    ? services.find(service => service.id === activeServiceId) || null
    : null;

  // Load projects when organization changes
  useEffect(() => {
    if (activeOrganizationId) {
      const loadProjects = async () => {
        setLoadingProjects(true);
        try {
          const projectsData = await getProjects(activeOrganizationId);
          setProjects(projectsData);
          
          // Set active project from URL or first project
          const projectIdFromParams = params?.projectId as string;
          if (projectIdFromParams && projectsData.some(p => p.id === projectIdFromParams)) {
            setActiveProjectIdState(projectIdFromParams);
          } else if (projectsData.length > 0 && (!activeProjectId || !projectsData.some(p => p.id === activeProjectId))) {
            setActiveProjectIdState(projectsData[0]?.id || null);
          }
        } catch (err) {
          console.error("Error loading projects:", err);
        } finally {
          setLoadingProjects(false);
        }
      };
      
      loadProjects();
    } else {
      setProjects([]);
      setActiveProjectIdState(null);
    }
  }, [activeOrganizationId, params?.projectId]);
  
  // Load services when project changes
  useEffect(() => {
    if (activeProjectId) {
      const loadServices = async () => {
        setLoadingServices(true);
        try {
          const servicesData = await getServices(activeProjectId);
          setServices(servicesData);
          
          // Set active service from URL or first service
          const serviceIdFromParams = params?.serviceId as string;
          if (serviceIdFromParams && servicesData.some(s => s.id === serviceIdFromParams)) {
            setActiveServiceIdState(serviceIdFromParams);
          }
        } catch (err) {
          console.error("Error loading services:", err);
        } finally {
          setLoadingServices(false);
        }
      };
      
      loadServices();
    } else {
      setServices([]);
      setActiveServiceIdState(null);
    }
  }, [activeProjectId, params?.serviceId]);

  // Refresh all data
  const refreshData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [userData, orgsData] = await Promise.all([
        getUser(),
        getOrganizations(),
      ]);
      
      setUser(userData);
      setOrganizations(orgsData);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "No authentication token found" || err.message === "Authentication expired") {
          router.push("/login");
        } else {
          setError("Failed to load data");
          console.error("Dashboard data fetch error:", err);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    removeToken();
    router.push('/login');
  };

  // Load initial data
  useEffect(() => {
    // Check for token first
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    refreshData();
  }, []);

  return (
    <DashboardContext.Provider value={{ 
      // Auth values
      loading,
      user,
      organizations,
      error,
      logout,
      refreshData,
      
      // Organization values
      activeOrganizationId,
      setActiveOrganizationId,
      activeOrganization,
      
      // Project values
      projects,
      activeProjectId,
      setActiveProjectId,
      activeProject,
      loadingProjects,
      
      // Service values
      services,
      activeServiceId,
      setActiveServiceId,
      activeService,
      loadingServices
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}
