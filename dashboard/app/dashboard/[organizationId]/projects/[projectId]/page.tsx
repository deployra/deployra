'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Code, Plus, ExternalLink, GitBranch, Calendar } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { getServices } from '@/lib/api';
import { Service } from '@/lib/models';
import { ServiceBadge } from '@/components/service/service-badge';
import { ServiceStatusBadge } from '@/components/service/status-badge';

export default function ProjectPage() {
  const router = useRouter();
  const params = useParams();
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;
  
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchServices();
  }, [projectId]);
  
  async function fetchServices() {
    setLoading(true);
    try {
      const data = await getServices(projectId);
      setServices(data);
    } catch (error) {
      console.error('Failed to fetch services:', error);
      toast.error('Failed to load services');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string | undefined) {
    if (!dateString) return 'Not deployed yet';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  
  return (
    <div className="container mb-10 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Project Overview"
          description="Manage your project resources and settings"
          icon={Code}
        />
        {services.length > 0 && (<Button asChild>
          <Link href={`/dashboard/${organizationId}/projects/${projectId}/create-service`}>
            <Plus className="h-4 w-4" />
            Add Service
          </Link>
        </Button>)}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-1/2 mb-2" />
                <Skeleton className="h-3 w-3/4" />
              </CardHeader>
              <CardContent className="pb-2">
                <div className="flex flex-col space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : services.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <Code className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No services found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              You haven&apos;t created any services for this project yet.
            </p>
            <Button asChild>
              <Link href={`/dashboard/${organizationId}/projects/${projectId}/create-service`}>
                <Plus className="h-4 w-4" />
                Create your first service
              </Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service) => (
            <Card key={service.id} className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center space-x-2">
                    <CardTitle className="text-lg">{service.name}</CardTitle>
                  </div>
                  <div className="flex items-center space-x-2">
                    <ServiceStatusBadge status={service.status} />
                    <ServiceBadge type={service.serviceTypeId} />
                  </div>
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                  <div className="flex items-center">
                    <Calendar className="h-3.5 w-3.5 mr-1" />
                    <span>Created {formatDate(service.createdAt)}</span>
                  </div>
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  asChild
                >
                  <Link href={`/dashboard/${organizationId}/projects/${projectId}/services/${service.id}`}>
                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                    View Details
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
