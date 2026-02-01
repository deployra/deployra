'use client';

import React, { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
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

// Web service form component
export function WebServiceFixedForm({ 
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
      containerCommand: "",
    },
    mode: "onChange",
  });

  const gitProviderId = form.watch('gitProviderId');
  const repositoryName = form.watch('repositoryName');
  const branch = form.watch('branch');
  const dockerImageUrl = form.watch('dockerImageUrl');
  const sourceCode = form.watch('sourceCode');

  // Custom form submission handler with validation
  const handleSubmit = async (data: ApplicationFormValues) => {
    // Validate source code requirements
    const hasGitSource = gitProviderId && repositoryName && branch;
    const hasDockerSource = dockerImageUrl;
    const isSourceValid = sourceCode || hasGitSource || hasDockerSource;

    if (!isSourceValid) {
      form.setError("sourceCode", { 
        type: "manual", 
        message: "Please provide source code information" 
      });
      return;
    }
    
    await onSubmit(data);
  };

  // Handle instance type selection
  const handleInstanceTypeChange = useCallback((instanceType: InstanceType | null) => {
    setSelectedInstanceType(instanceType);
  }, []);

  // Handle form submission with error handling
  const handleFormSubmit = form.handleSubmit(handleSubmit, (errors) => {
    console.error("Form validation failed:", errors);
    
    // Scroll to error sections
    if (errors.instanceTypeId) {
      const instanceTypeSection = document.querySelector('.instance-type-section');
      if (instanceTypeSection) {
        instanceTypeSection.classList.add('border-red-500');
        instanceTypeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    if (errors.sourceCode) {
      const sourceCodeSection = document.querySelector('.source-code-section');
      if (sourceCodeSection) {
        sourceCodeSection.classList.add('border-red-500');
        sourceCodeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={handleFormSubmit} className="space-y-6">
          {/* Service Information Section */}
          <div className="border rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-medium mb-4">Service Information</h3>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter service name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Source Code Section */}
          <SourceCodeSection
            control={form.control}
            setValue={form.setValue}
            watch={form.watch}
            gitProviders={gitProviders}
            hasError={!!form.formState.errors.sourceCode}
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

          {/* Advanced Settings Section */}
          <div className="border rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-medium mb-4">Advanced Settings</h3>
            <FormField
              control={form.control}
              name="containerCommand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Container Command (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g., node server.js or python -m flask run'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Overrides the default container ENTRYPOINT/CMD. Enter the command as you would in a shell.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Instance Type Section */}
          <InstanceTypeSection
            control={form.control}
            setValue={form.setValue}
            watch={form.watch}
            instanceTypeGroups={instanceTypeGroups}
            hasError={!!form.formState.errors.instanceTypeId}
            onInstanceTypeChange={handleInstanceTypeChange}
          />

          {/* Submit Button */}
          <div className="flex justify-end mt-8">
            <Button 
              type="submit" 
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Service
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
