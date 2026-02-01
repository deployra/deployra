'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { 
  ServiceType, 
  InstanceTypeGroup, 
  InstanceType, 
  GitProvider,
} from '@/lib/models';

// Import shared types and schema
import { applicationServiceFormSchema, ApplicationFormValues } from './create-service/types';

// Import the separate components
import { SourceCodeSection } from './create-service/source-code-section';
import { EnvironmentVariablesSection } from './create-service/environment-variables-section';
import { PortSettingsSection } from './create-service/port-settings-section';
import { InstanceTypeSection } from './create-service/instance-type-section';
import { StorageSection } from './create-service/storage-section';

// Base form props interface
interface BaseFormProps {
  serviceType: ServiceType;
  gitProviders?: GitProvider[];
  onSubmit: (data: ApplicationFormValues) => Promise<void>;
  loading: boolean;
  instanceTypeGroups?: InstanceTypeGroup[];
}

// Private service form component
export function PrivateServiceFixedForm({ 
  serviceType,
  gitProviders = [],
  onSubmit,
  loading,
  instanceTypeGroups = [],
}: BaseFormProps) {
  const params = useParams();
  const projectId = params.projectId as string;
  const [selectedInstanceType, setSelectedInstanceType] = useState<InstanceType | null>(null);

  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationServiceFormSchema),
    defaultValues: {
      projectId: projectId,
      serviceTypeId: serviceType.id,
      name: "",
      gitProviderId: "",
      repositoryName: "",
      branch: "",
      runtimeFilePath: "",
      dockerImageUrl: "",
      dockerUsername: "",
      dockerPassword: "",
      instanceTypeId: "",
      environmentVariables: [],
      portSettings: [{ servicePort: 80, containerPort: 3000 }],
      sourceCode: false,
      storageEnabled: false,
      storageCapacity: 10,
    },
    mode: "onChange",
  });

  const instanceTypeId = form.watch('instanceTypeId');

  // Update selected instance type when form value changes
  useEffect(() => {
    if (instanceTypeId && instanceTypeGroups) {
      const foundType = instanceTypeGroups
        .flatMap(group => group.instanceTypes)
        .find(type => type.id === instanceTypeId);
      setSelectedInstanceType(foundType || null);
    } else {
      setSelectedInstanceType(null);
    }
  }, [instanceTypeId, instanceTypeGroups]);

  // Custom form submission handler to include additional validation
  const handleSubmit = async (data: ApplicationFormValues) => {
    try {
      // Ensure sourceCode is set based on the selected source type
      const finalData = {
        ...data,
        sourceCode: data.gitProviderId ? true : false,
      };

      await onSubmit(finalData);
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
          {/* Service Information */}
          <div className="border rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-medium mb-4">Service Information</h3>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter service name" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Source Code Section */}
          <SourceCodeSection
            control={form.control}
            setValue={form.setValue}
            watch={form.watch}
            gitProviders={gitProviders}
          />

          {/* Environment Variables Section */}
          <EnvironmentVariablesSection
            control={form.control}
            getValues={form.getValues}
            setValue={form.setValue}
            watch={form.watch}
          />

          {/* Port Settings Section */}
          <PortSettingsSection
            control={form.control}
            watch={form.watch}
          />

          {/* Storage Section */}
          <StorageSection
            control={form.control}
            watch={form.watch}
          />

          {/* Instance Type Section */}
          <InstanceTypeSection
            control={form.control}
            setValue={form.setValue}
            watch={form.watch}
            instanceTypeGroups={instanceTypeGroups}
            hasError={!!form.formState.errors.instanceTypeId}
            onInstanceTypeChange={(instanceType) => setSelectedInstanceType(instanceType)}
          />

          {/* Submit Button */}
          <div className="flex justify-end">
            <Button 
              type="submit" 
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Private Service
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
