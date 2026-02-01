'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { 
  Server, 
  ArrowLeft,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';

// Import service form components
import { WebServiceFixedForm } from '@/components/web-service-fixed-form';
import { PrivateServiceFixedForm } from '@/components/private-service-fixed-form';
import { MysqlServiceForm } from '@/components/mysql-service-form';
import { MemoryServiceForm } from '@/components/memory-service-form';
import { PostgresqlServiceForm } from '@/components/postgresql-service-form';

import { 
  getGitProviders, 
  createService,  
  getServiceTypes, 
  getInstanceTypeGroups, 
  ApiError,
} from '@/lib/api';
import { CreateServiceInput, ServiceType, InstanceTypeGroup, GitProvider } from '@/lib/models';
import { notFound } from 'next/navigation';
import Link from 'next/link';

// Create a comprehensive form schema type that includes all possible fields
// to avoid TypeScript errors when accessing properties
type FormValues = {
  projectId: string;
  serviceTypeId: string;
  name: string;
  gitProviderId?: string;
  repositoryName?: string;
  branch?: string;
  runtimeFilePath?: string;
  dockerImageUrl?: string;
  storageCapacity?: number;
  storageEnabled?: boolean;
  instanceTypeId: string;
  environmentVariables?: {
    key: string;
    value: string;
  }[];
  portSettings?: {
    servicePort: number;
    containerPort: number;
  }[];
};

export default function ServiceTypePage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;
  const serviceTypeId = params.serviceTypeId as string;
  
  const [loading, setLoading] = useState(false);
  const [gitProviders, setGitProviders] = useState<GitProvider[]>([]);
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [instanceTypeGroups, setInstanceTypeGroups] = useState<InstanceTypeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load data on page load
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        
        // Load the service types and git providers in parallel
        const [types, providers] = await Promise.all([
          getServiceTypes(),
          getGitProviders(organizationId),
        ]);
        
        // Find the requested service type
        const foundType = types.find(type => type.id === serviceTypeId);
        if (!foundType) {
          notFound();
        }
        
        setServiceType(foundType);
        setGitProviders(providers);
        
        // Load instance type groups after we know the service type
        if (foundType) {
          const instanceGroups = await getInstanceTypeGroups(foundType.id);
          setInstanceTypeGroups(instanceGroups);
        }
        
      } catch (error) {
        console.error('Failed to load data:', error);
        toast.error('Failed to load service data');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [organizationId, serviceTypeId]);

  const onSubmit = async (values: FormValues) => {
    try {
      setLoading(true);
      
      // Prepare service data
      const serviceData: CreateServiceInput = {
        name: values.name,
        projectId: values.projectId,
        serviceTypeId: values.serviceTypeId,
        instanceTypeId: values.instanceTypeId || "", // Provide a default empty string if undefined
      };
      
      // Add Git-related properties only for web and private service types
      if (values.serviceTypeId === 'web' || values.serviceTypeId === 'private') {
        serviceData.dockerImageUrl = values.dockerImageUrl;
        serviceData.gitProviderId = values.gitProviderId;
        serviceData.repositoryName = values.repositoryName;
        serviceData.branch = values.branch;
        serviceData.runtimeFilePath = values.runtimeFilePath;
        
        // Add environment variables if provided
        if (values.environmentVariables && values.environmentVariables.length > 0) {
          const validEnvVars = values.environmentVariables.filter(
            env => env.key && env.value
          );
          serviceData.environmentVariables = validEnvVars;
        }
      }

      if (!values.instanceTypeId) {
        toast.error('Instance type is required');
        return;
      }

      // Add port settings if provided
      if (values.portSettings && values.portSettings.length > 0) {
        serviceData.portSettings = values.portSettings;
      }

      // Add storage capacity and instance type for MySQL service type
      if (values.serviceTypeId === 'mysql') {
        if (!values.storageCapacity) {
          toast.error('Storage capacity is required for MySQL services');
          return;
        }
        
        if (values.storageCapacity < 10) {
          toast.error('MySQL storage capacity must be at least 10GB');
          return;
        }
        
        serviceData.storageCapacity = values.storageCapacity;
      }
      
      // Add storage capacity for Memory service type if enabled
      if (values.serviceTypeId === 'memory') {
        // Add storage capacity only if storage is enabled
        if (values.storageEnabled) {
          if (!values.storageCapacity) {
            toast.error('Storage capacity is required when storage is enabled for Memory services');
            return;
          }

          if (values.storageCapacity < 10) {
            toast.error('Memory storage capacity must be at least 10GB when enabled');
            return;
          }

          serviceData.storageCapacity = values.storageCapacity;
        }
      }
      
      // Add validation for PostgreSQL service type
      if (values.serviceTypeId === 'postgresql') {
        if (!values.storageCapacity) {
          toast.error('Storage capacity is required for PostgreSQL services');
          return;
        }

        if (values.storageCapacity < 10) {
          toast.error('PostgreSQL storage capacity must be at least 10GB');
          return;
        }

        serviceData.storageCapacity = values.storageCapacity;
      }

      // Add storage capacity if storage is enabled (optional for web/private)
      if ((values.serviceTypeId === 'web' || values.serviceTypeId === 'private') && values.storageEnabled) {
        if (!values.storageCapacity) {
          toast.error('Storage capacity is required when storage is enabled');
          return;
        }

        if (values.storageCapacity < 10) {
          toast.error('Storage capacity must be at least 10GB');
          return;
        }

        serviceData.storageCapacity = values.storageCapacity;
      }

      try {
        await createService(serviceData);
        
        toast.success('Service created successfully!');
        router.push(`/dashboard/${organizationId}/projects/${projectId}`);
      } catch (error: unknown) {
        if (error instanceof ApiError) {
          toast.error(`Failed to create service: ${error.message}`);
        } else {
          toast.error('Failed to create service');
        }
      }
    } catch (err) {
      console.error('Error in form submission:', err);
      toast.error('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl space-y-8">
        <PageHeader
          title="Create Service"
          description="Configure your new service"
          icon={Server}
        />
        
        <div className="space-y-6">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-10 w-full mb-4" />
          <Skeleton className="h-10 w-full mb-4" />
          <Skeleton className="h-10 w-full mb-4" />
          <Skeleton className="h-10 w-1/3" />
        </div>
      </div>
    );
  }

  if (!serviceType) {
    return notFound();
  }

  // Render the appropriate form based on service type
  const renderServiceForm = () => {
    switch (serviceType.id) {
      case 'web':
        return (
          <WebServiceFixedForm
            serviceType={serviceType}
            gitProviders={gitProviders}
            onSubmit={onSubmit}
            loading={loading}
            instanceTypeGroups={instanceTypeGroups}
          />
        );
      case 'private':
        return (
          <PrivateServiceFixedForm
            serviceType={serviceType}
            gitProviders={gitProviders}
            onSubmit={onSubmit}
            loading={loading}
            instanceTypeGroups={instanceTypeGroups}
          />
        );
      case 'mysql':
        return (
          <MysqlServiceForm
            serviceType={serviceType}
            onSubmit={onSubmit}
            loading={loading}
            instanceTypeGroups={instanceTypeGroups}
          />
        );
      case 'memory':
        return (
          <MemoryServiceForm
            serviceType={serviceType}
            onSubmit={onSubmit}
            loading={loading}
            instanceTypeGroups={instanceTypeGroups}
          />
        );
      case 'postgresql':
        return (
          <PostgresqlServiceForm
            serviceType={serviceType}
            onSubmit={onSubmit}
            loading={loading}
            instanceTypeGroups={instanceTypeGroups}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        title="Create Service"
        description="Configure your new service"
        icon={Server}
      />
      
      {/* Service type selection */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <div className="flex items-center space-x-3">
          <Link
            href={`/dashboard/${organizationId}/projects/${projectId}/create-service`}
            className="text-primary hover:underline"
          >
            <div className="w-10 h-10 flex items-center justify-center rounded-md bg-primary/10">
              <ArrowLeft className="h-4 w-4" />
            </div>
          </Link>
          <div className="ml-4">
            <p className="font-medium">{serviceType?.title}</p>
            <p className="text-sm text-muted-foreground">{serviceType?.description}</p>
          </div>
        </div>
      </div>

      {renderServiceForm()}
    </div>
  );
}
