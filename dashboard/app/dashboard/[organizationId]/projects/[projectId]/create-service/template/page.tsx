'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { 
  Server, 
  ArrowLeft,
  Copy
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateServiceForm } from '@/components/template-service-form';
import Link from 'next/link';

import { 
  getInstanceTypeGroups, 
  ApiError,
  createServicesFromTemplate,
  getTemplate,
} from '@/lib/api';
import { InstanceTypeGroup, CreateServiceInput, ServiceType, Template } from '@/lib/models';

// Template service type data (hardcoded since it's not in the API)
const templateServiceType: ServiceType = {
  id: 'template',
  title: 'Template',
  description: 'Create services from an existing service template',
  tagId: 'template',
  tag: {
    id: 'template',
    label: 'Template',
    index: 999,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  index: 1,
  isVisible: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export default function TemplateServicePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;
  const templateSlug = searchParams.get('slug');
  
  const [loading, setLoading] = useState(false);
  const [instanceTypeGroups, setInstanceTypeGroups] = useState<InstanceTypeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [prefilledYaml, setPrefilledYaml] = useState<string>('');
  
  // Load data on page load
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        
        // Load instance type groups
        const instanceGroups = await getInstanceTypeGroups(templateServiceType.id);
        setInstanceTypeGroups(instanceGroups);
        
        // Load template if slug is provided
        if (templateSlug) {
          try {
            const templateData = await getTemplate(templateSlug);
            setTemplate(templateData);
            setPrefilledYaml(templateData.yamlTemplate);
          } catch (error) {
            console.error('Failed to load template:', error);
            toast.error('Failed to load template data');
          }
        }
        
      } catch (error) {
        console.error('Failed to load data:', error);
        toast.error('Failed to load service data');
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [organizationId, templateSlug]);

  // Form submission handler
  const handleFormSubmit = async (values: CreateServiceInput & { yamlTemplate: string }) => {
    setLoading(true);
    setError('');
    
    try {
      // Create services from template using the API function
      const result = await createServicesFromTemplate(projectId, values.yamlTemplate);
      
      // Show success toast
      toast.success(`Successfully created ${result.length} services from template`);
      
      // Redirect to project page
      router.push(`/dashboard/${organizationId}/projects/${projectId}`);
    } catch (error: unknown) {
      console.error('Error creating services from template:', error);

      if (error instanceof ApiError) {
        setError(error.message || 'Failed to create services from template');
      } else if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mb-10 space-y-6">
        <PageHeader
          title="Create Services from Template"
          description="Configure and deploy multiple services using a YAML template definition"
          icon={Copy}
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

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        title="Create Services from Template"
        description="Configure and deploy multiple services using a YAML template definition"
        icon={Copy}
      />
      
      {/* Service type selection */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <div className="flex items-center justify-between">
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
              <p className="font-medium">{templateServiceType.title}</p>
              <p className="text-sm text-muted-foreground">{templateServiceType.description}</p>
            </div>
          </div>
          <Link
            href="/templates"
            className="text-primary hover:underline"
          >
            <div className="flex items-center space-x-2 px-3 py-2 rounded-md bg-primary/10">
              <Server className="h-4 w-4" />
              <span className="text-sm font-medium">Templates</span>
            </div>
          </Link>
        </div>
      </div>

      <TemplateServiceForm
        serviceType={templateServiceType}
        onSubmit={handleFormSubmit}
        loading={loading}
        instanceTypeGroups={instanceTypeGroups}
        prefilledYaml={prefilledYaml}
        templateTitle={template?.title}
      />
    </div>
  );
}
