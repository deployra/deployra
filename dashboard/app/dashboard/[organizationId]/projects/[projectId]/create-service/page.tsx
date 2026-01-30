'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Server, Database, MemoryStick, Code, Cloud, Copy } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

import { getServiceTypes } from '@/lib/api';
import { ServiceType } from '@/lib/models';
import Link from 'next/link';
import { ServiceIcon } from '@/components/service/service-icon';

export default function CreateServicePage() {
  const params = useParams();
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;
  
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [isLoadingServiceTypes, setIsLoadingServiceTypes] = useState(true);

  const [serviceTypeTags, setServiceTypeTags] = useState<Record<string, { label: string; index: number }>>({});
  const [activeTags, setActiveTags] = useState<string[]>([]);

  useEffect(() => {
    loadServiceTypes();
  }, [organizationId]);

  async function loadServiceTypes() {
    try {
      setIsLoadingServiceTypes(true);
      const types = await getServiceTypes();
      
      // Add template service type
      const templateServiceType: ServiceType = {
        id: 'template',
        title: 'Template',
        description: 'Create services from an existing service template',
        tagId: 'template',
        tag: {
          id: 'template',
          label: 'Template',
          index: 999, // Will be displayed at the bottom
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        index: 1,
        isVisible: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      setServiceTypes([...types, templateServiceType]);

      // Add template tag along with other tags
      for (const type of [...types, templateServiceType]) {
        if (!serviceTypeTags[type.tag.id]) {
          setServiceTypeTags(prev => ({
            ...prev,
            [type.tag.id]: { label: type.tag.label, index: type.tag.index },
          }));
        }
      }

    } catch (error) {
      console.error('Failed to load service types:', error);
      toast.error('Failed to load service types');
    } finally {
      setIsLoadingServiceTypes(false);
    }
  }

  // Initialize active tags from service types
  useEffect(() => {
    if (serviceTypes.length > 0) {
      // Get unique tags for filtering
      const uniqueTags = Array.from(new Set(serviceTypes.map(type => type.tag.id)));
      setActiveTags(uniqueTags);
      setIsLoadingServiceTypes(false);
    }
  }, [serviceTypes]);

  const handleTagFilter = (tagId: string) => {
    if (activeTags.includes(tagId)) {
      setActiveTags(activeTags.filter(t => t !== tagId));
    } else {
      setActiveTags([...activeTags, tagId]);
    }
  };

  // Filter service types based on selected tags
  const filteredServiceTypes = serviceTypes.filter(type => 
    activeTags.includes(type.tag.id) && type.isVisible
  );

  // Get unique tags from service types
  const uniqueTagIds = Array.from(new Set(serviceTypes.map(type => type.tag.id)));

  // Sort unique tags according to serviceTypeTags order
  const sortedUniqueTagIds = [...uniqueTagIds].sort((a, b) => {
    const indexA = serviceTypeTags[a as keyof typeof serviceTypeTags]?.index || 999;
    const indexB = serviceTypeTags[b as keyof typeof serviceTypeTags]?.index || 999;
    return indexA - indexB;
  });

  const serviceTypesByTag: Record<string, ServiceType[]> = {};
    
  filteredServiceTypes.forEach(serviceType => {
    const tagId = serviceType.tag.id;
    if (!serviceTypesByTag[tagId]) {
      serviceTypesByTag[tagId] = [];
    }
    serviceTypesByTag[tagId].push(serviceType);
  });

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        title="Create Service"
        description="Deploy a new service for your project"
        icon={Server}
      />
      
      {isLoadingServiceTypes ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[...Array(2)].map((_, i) => (
              <Card key={i} className="hover:border-primary transition-colors">
                <CardHeader className="pb-2">
                  <Skeleton className="h-6 w-32 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8 mb-10">
            <div className="flex flex-wrap gap-2 mb-4">
              {sortedUniqueTagIds.map(tagId => (
                <Badge 
                  key={tagId}
                  variant={activeTags.includes(tagId) ? "default" : "outline"}
                  className="cursor-pointer capitalize"
                  onClick={() => handleTagFilter(tagId)}
                >
                  {serviceTypeTags[tagId as keyof typeof serviceTypeTags]?.label || tagId}
                </Badge>
              ))}
            </div>
            
            {sortedUniqueTagIds.filter(tagId => serviceTypesByTag[tagId] && serviceTypesByTag[tagId].length > 0).map(tagId => (
              <div key={tagId} className="space-y-4">
                <div className="flex items-center space-x-2">
                  {/* Icon for each tag group */}
                  {tagId === 'application' && <Server className="h-5 w-5" />}
                  {tagId === 'database' && <Database className="h-5 w-5" />}
                  {tagId === 'memory' && <MemoryStick className="h-5 w-5" />}
                  {tagId === 'data' && <Code className="h-5 w-5" />}
                  {tagId === 'cloud' && <Cloud className="h-5 w-5" />}
                  {tagId === 'template' && <Copy className="h-5 w-5" />}
                  <h3 className="text-lg font-medium capitalize">
                    {serviceTypeTags[tagId as keyof typeof serviceTypeTags]?.label || tagId}
                  </h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {serviceTypesByTag[tagId].map((serviceType) => {                    
                    return (
                      <Link
                        key={serviceType.id}
                        href={serviceType.id === 'template' 
                          ? `/dashboard/${organizationId}/projects/${projectId}/create-service/template`
                          : `/dashboard/${organizationId}/projects/${projectId}/create-service/${serviceType.id}`
                        }
                      >
                        <Card 
                          key={serviceType.id}
                          className={cn(
                            "relative overflow-hidden",
                            "transition-all duration-300 ease-in-out",
                            "hover:shadow-md cursor-pointer",
                            "border-border hover:border-muted-foreground"
                          )}
                        >
                          <CardHeader>
                            <div className="flex items-center space-x-2">
                              <ServiceIcon type={serviceType.id} className="h-5 w-5" />
                              <CardTitle className="text-lg">{serviceType.title}</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <CardDescription>{serviceType.description}</CardDescription>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
      )}
    </div>
  );
}
