'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { ServiceType, InstanceTypeGroup, InstanceType } from '@/lib/models';

// PostgreSQL service form schema with storage capacity and instance type
const postgresqlServiceFormSchema = z.object({
  name: z.string().min(1, { message: "Service name is required" }),
  projectId: z.string(),
  serviceTypeId: z.string(),
  storageEnabled: z.boolean().default(true),
  storageCapacity: z.number().min(10).refine(
    (val) => val % 5 === 0,
    { message: "Storage must be a multiple of 5 GB" }
  ),
  instanceTypeId: z.string().min(1, { message: "Instance type is required" }),
});

// Form types
type PostgresqlServiceFormValues = z.infer<typeof postgresqlServiceFormSchema>;

// Base form props interface
interface BaseFormProps {
  serviceType: ServiceType;
  gitProviders?: any[];
  onSubmit: (data: PostgresqlServiceFormValues) => Promise<void>;
  loading: boolean;
  instanceTypeGroups?: InstanceTypeGroup[];
}

// PostgreSQL service form component
export function PostgresqlServiceForm({ 
    serviceType,
    onSubmit,
    loading,
    instanceTypeGroups = [],
  }: BaseFormProps) {
    const params = useParams();
    const projectId = params.projectId as string;
    const [storagePrice, setStoragePrice] = useState<string>("5.00"); // Default formatted price
    const [selectedInstanceType, setSelectedInstanceType] = useState<InstanceType | null>(null);
  
    const form = useForm<PostgresqlServiceFormValues>({
      resolver: zodResolver(postgresqlServiceFormSchema),
      defaultValues: {
        projectId: projectId,
        serviceTypeId: serviceType.id,
        name: "",
        storageEnabled: true,
        storageCapacity: 10, // Default to 10GB
        instanceTypeId: "",
      },
      mode: "onChange", // Change to onChange for live validation
    });
  
    // Calculate price whenever storage capacity changes
    const storageCapacity = form.watch('storageCapacity');
    const instanceTypeId = form.watch('instanceTypeId');
    
    useEffect(() => {
      if (storageCapacity) {
        // Check if the storage value is valid (multiple of 5GB)
        const isValid = storageCapacity % 5 === 0;
        if (isValid) {
          // First 10GB is free for PostgreSQL services
          const chargableStorage = Math.max(0, storageCapacity - 10);
          setStoragePrice((chargableStorage * 0.05).toFixed(2)); // $0.05 per GB for usage beyond 10GB
        } else {
          setStoragePrice("-"); // Show dash when value is invalid
        }
      } else {
        setStoragePrice("-"); // Show dash when no value
      }
    }, [storageCapacity]);
  
    // Update selected instance type when instanceTypeId changes
    useEffect(() => {
      if (instanceTypeId && instanceTypeGroups.length > 0) {
        for (const group of instanceTypeGroups) {
          const foundType = group.instanceTypes.find(type => type.id === instanceTypeId);
          if (foundType) {
            setSelectedInstanceType(foundType);
            return;
          }
        }
      } else {
        setSelectedInstanceType(null);
      }
    }, [instanceTypeId, instanceTypeGroups]);
  
    const handleFormSubmit = form.handleSubmit(async (data) => {
      await onSubmit(data);
    }, (errors) => {
      // This callback is called when form validation fails
      console.error("Form validation failed:", errors);
      
      // Check for instance type error specifically
      if (errors.instanceTypeId) {
        // Scroll to the instance type section
        const instanceTypeSection = document.querySelector('.instance-type-section');
        if (instanceTypeSection) {
          instanceTypeSection.classList.add('border-red-500');
          instanceTypeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  
    const instanceTypeContainerClass = (error: boolean) => 
      cn(
        "border rounded-lg p-6 shadow-sm instance-type-section", 
        { "border-red-500": error }
      );
  
    return (
      <div className="space-y-6">
        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="space-y-6">
            <div className="border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-medium mb-4">Service Information</h3>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter service name" 
                        value={field.value || ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
  
            <div className={instanceTypeContainerClass(!!form.formState.errors.instanceTypeId)}>
              <h3 className="text-lg font-medium mb-4">Instance Type</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Select an instance type that best fits your performance needs
              </p>
              
              {instanceTypeGroups.length === 0 ? (
                <div className="space-y-2">
                  <Skeleton className="h-[60px] w-full" />
                  <Skeleton className="h-[60px] w-full" />
                  <Skeleton className="h-[60px] w-full" />
                </div>
              ) : (
                <div className="space-y-6">
                  {instanceTypeGroups.map((group) => (
                    <div key={group.id} className="space-y-3">
                      <h4 className="text-md font-medium">{group.name}</h4>
                      {group.description && (
                        <p className="text-sm text-muted-foreground">{group.description}</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.instanceTypes.map((type) => (
                          <div
                            key={type.id}
                            className={cn(
                              "border rounded-lg p-4 cursor-pointer hover:border-primary transition-colors",
                              instanceTypeId === type.id ? "border-primary bg-primary/5" : "border-border"
                            )}
                            onClick={() => form.setValue("instanceTypeId", type.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <div className="font-medium">{type.name}</div>
                                {type.description && (
                                  <div className="text-sm text-muted-foreground">{type.description}</div>
                                )}
                                <div className="text-sm space-y-0.5">
                                  <div><span className="font-medium">{type.cpuCount}</span> CPU</div>
                                  <div><span className="font-medium">{type.memoryMB >= 1024 ? `${(type.memoryMB / 1024).toFixed(1)} GB` : `${type.memoryMB} MB`}</span> RAM</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <FormField
                        control={form.control}
                        name="instanceTypeId"
                        render={({ field }) => (
                          <FormItem className="hidden">
                            <FormControl>
                              <Input {...field} type="hidden" />
                            </FormControl>
                            <FormMessage className="mt-4 text-center" />
                          </FormItem>
                        )}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
  
            <div className="border rounded-lg p-6 shadow-sm">
              <h3 className="text-lg font-medium mb-4">Storage Configuration</h3>
              <FormField
                control={form.control}
                name="storageCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size</FormLabel>
                    <div className="space-y-2">
                      <FormControl>
                        <div className="flex items-center gap-4">
                          <div className="relative flex-1 min-w-0">
                            <Input 
                              type="number"
                              min={10}
                              step={5}
                              placeholder="Storage capacity in GB" 
                              value={field.value || 10}
                              onChange={(e) => {
                                const value = parseInt(e.target.value);
                                if (!isNaN(value) && value >= 10) {
                                  field.onChange(value);
                                }
                              }}
                              onBlur={field.onBlur}
                              name={field.name}
                              className="pr-10"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-sm font-medium text-muted-foreground">
                              GB
                            </div>
                          </div>
                          <div className="text-sm font-medium whitespace-nowrap flex-shrink-0">${storagePrice} / month</div>
                        </div>
                      </FormControl>
                      <FormMessage />
                      <p className="text-sm text-muted-foreground">
                        Your database&apos;s capacity, in GB. You can increase storage at any time, but you can&apos;t decrease it. 
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Specify 10 GB or any multiple of 5 GB.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            </div>
  
            <div className="flex justify-end mt-8">
              <Button 
                type="submit" 
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Service
              </Button>
            </div>
          </form>
        </Form>
      </div>
    );
  }