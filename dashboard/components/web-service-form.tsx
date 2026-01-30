'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, Check, X, PlusCircle, Github, GitBranch } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  getRepositories, 
  getBranches, 
  getRepositoryDescription,
  validateDockerImage,
} from '@/lib/api';
import { ServiceType, InstanceTypeGroup, InstanceType, Repository, Branch, GitProvider, RepositoryDescription } from '@/lib/models';
import { Textarea } from './ui/textarea';

// Application service form schema (for web and private services)
const applicationServiceFormSchema = z.object({
  name: z.string().min(1, { message: "Service name is required" }),
  projectId: z.string(),
  serviceTypeId: z.string(),
  gitProviderId: z.string().optional(),
  repositoryName: z.string().optional(),
  branch: z.string().optional(),
  runtimeFilePath: z.string().optional(),
  dockerImageUrl: z.string().optional(),
  environmentVariables: z.array(
    z.object({
      key: z.string().min(1, { message: "Key is required" }),
      value: z.string()
    })
  ).default([]),
  portSettings: z.array(
    z.object({
      servicePort: z.number().int().min(1).max(65535),
      containerPort: z.number().int().min(1).max(65535)
    })
  ).default([{ servicePort: 80, containerPort: 3000 }]),
  instanceTypeId: z.string().min(1, { message: "Please select an instance type" }),
  sourceCode: z.boolean().default(false),
});

// Form types
type ApplicationFormValues = z.infer<typeof applicationServiceFormSchema>;

// Base form props interface
interface BaseFormProps {
  serviceType: ServiceType;
  gitProviders?: GitProvider[];
  onSubmit: (data: ApplicationFormValues) => Promise<void>;
  loading: boolean;
  instanceTypeGroups?: InstanceTypeGroup[];
}

// Web service form component
export function WebServiceForm({ 
  serviceType,
  gitProviders = [],
  onSubmit,
  loading,
  instanceTypeGroups = [],
}: BaseFormProps) {
  const params = useParams();
  const projectId = params.projectId as string;
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedInstanceType, setSelectedInstanceType] = useState<InstanceType | null>(null);
  const [repoDescription, setRepoDescription] = useState<RepositoryDescription | null>(null);
  const [loadingRepoDescription, setLoadingRepoDescription] = useState(false);
  const [validatingDockerImage, setValidatingDockerImage] = useState(false);
  const [isDockerImageValid, setIsDockerImageValid] = useState<boolean | null>(null);
  const [sourceType, setSourceType] = useState<"git-provider" | "existing-image">("git-provider");
  const [selectedProviderType, setSelectedProviderType] = useState<"GITHUB" | "CUSTOM" | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
      instanceTypeId: "",
      environmentVariables: [],
      portSettings: [{ servicePort: 80, containerPort: 3000 }],
      sourceCode: false,
    },
  });

  const gitProviderId = form.watch('gitProviderId');
  const repositoryName = form.watch('repositoryName');
  const branch = form.watch('branch');
  const runtimeFilePath = form.watch('runtimeFilePath');
  const instanceTypeId = form.watch('instanceTypeId');
  const dockerImageUrl = form.watch('dockerImageUrl');
  const sourceCode = form.watch('sourceCode');

  // Custom form submission handler to include additional validation
  const handleSubmit = async (data: ApplicationFormValues) => {
    // Check if source code requirements are met
    const isSourceValid = sourceCode || 
      (gitProviderId && repositoryName && branch && (repoDescription?.hasDockerfile || repoDescription?.hasProcfile)) || 
      (dockerImageUrl && isDockerImageValid);

    if (!isSourceValid) {
      form.setError("sourceCode", { 
        type: "manual", 
        message: "Please provide source code information" 
      });
      return;
    }
    
    // Continue with the original onSubmit
    await onSubmit(data);
  };

  // Load repositories when git provider changes
  useEffect(() => {
    async function loadRepositories() {
      if (!gitProviderId) {
        setRepositories([]);
        return;
      }

      try {
        setLoadingRepositories(true);
        const repos = await getRepositories(gitProviderId);
        setRepositories(repos);
      } catch (error) {
        console.error("Failed to load repositories:", error);
        toast.error("Failed to load repositories");
      } finally {
        setLoadingRepositories(false);
      }
    }

    loadRepositories();
    form.setValue('repositoryName', '');
    form.setValue('branch', '');
    setRepoDescription(null);
  }, [gitProviderId]);

  // Load branches when repository changes
  useEffect(() => {
    async function loadBranches() {
      if (!gitProviderId || !repositoryName) {
        setBranches([]);
        return;
      }

      try {
        setLoadingBranches(true);
        const branchList = await getBranches(gitProviderId, repositoryName);
        setBranches(branchList);
      } catch (error) {
        console.error("Failed to load branches:", error);
        toast.error("Failed to load branches");
      } finally {
        setLoadingBranches(false);
      }
    }

    loadBranches();
    form.setValue('branch', '');
    setRepoDescription(null);
  }, [gitProviderId, repositoryName]);

  // Function to load repository description that can be reused
  const loadRepositoryDescription = async (path?: string) => {
    if (!gitProviderId || !repositoryName || !branch) {
      setRepoDescription(null);
      return;
    }

    try {
      setLoadingRepoDescription(true);
      const description = await getRepositoryDescription(gitProviderId, repositoryName, branch, path || runtimeFilePath);
      setRepoDescription(description);
    } catch (error) {
      console.error("Failed to load repository description:", error);
      setRepoDescription(null);
    } finally {
      setLoadingRepoDescription(false);
    }
  };

  // Function to handle debounced repository description fetch
  const debouncedLoadRepositoryDescription = (path: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      loadRepositoryDescription(path);
    }, 500); // 500ms debounce delay
  };

  // Load repository description when branch changes (without dockerfilePath to avoid excessive API calls)
  useEffect(() => {
    // Only trigger when branch, gitProviderId, or repositoryName changes
    loadRepositoryDescription();
  }, [gitProviderId, repositoryName, branch]);  // dockerfilePath is intentionally removed from dependencies

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

  useEffect(() => {
    setRepoDescription(null);
  }, [branch]);

  // Validate Docker image URL when it changes
  useEffect(() => {
    let isMounted = true;
    
    const validateImage = async () => {
      if (!dockerImageUrl) {
        setIsDockerImageValid(null);
        return;
      }
      
      try {
        setValidatingDockerImage(true);
        const isValid = await validateDockerImage(dockerImageUrl);
        
        if (isMounted) {
          setIsDockerImageValid(isValid);
        }
      } catch (error) {
        console.error("Failed to validate Docker image:", error);
        if (isMounted) {
          setIsDockerImageValid(false);
        }
      } finally {
        if (isMounted) {
          setValidatingDockerImage(false);
        }
      }
    };
    
    // Debounce validation to avoid too many API calls
    const debounceTimer = setTimeout(() => {
      if (dockerImageUrl) {
        validateImage();
      }
    }, 500);
    
    return () => {
      isMounted = false;
      clearTimeout(debounceTimer);
    };
  }, [dockerImageUrl]);

  // Check if there are git providers - fall back to Docker image if none are available  
  const hasGitProviders = gitProviders.length > 0;
  
  const handleFormSubmit = form.handleSubmit(handleSubmit, (errors) => {
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

    if (errors.sourceCode) {
      // Scroll to the source code section
      const sourceCodeSection = document.querySelector('.source-code-section');
      if (sourceCodeSection) {
        console.log("Scrolling to source code section");
        sourceCodeSection.classList.add('border-red-500');
        sourceCodeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  // Add new env variable
  const addEnvironmentVariable = () => {
    const currentEnvVars = form.getValues().environmentVariables || [];
    form.setValue('environmentVariables', [
      ...currentEnvVars,
      { key: '', value: '' }
    ]);
  };

  // Remove env variable
  const removeEnvironmentVariable = (index: number) => {
    const currentEnvVars = form.getValues().environmentVariables || [];
    form.setValue('environmentVariables', 
      currentEnvVars.filter((_, i) => i !== index)
    );
  };

  const instanceTypeContainerClass = (error: boolean) => 
    cn(
      "border rounded-lg p-6 shadow-sm instance-type-section", 
      { "border-red-500": error }
    );

  const sourceCodeContainerClass = (error: boolean) => 
    cn(
      "border rounded-lg p-6 shadow-sm source-code-section", 
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
                    <Input placeholder="Enter service name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className={sourceCodeContainerClass(!!form.formState.errors.sourceCode)}>
            <h3 className="text-lg font-medium mb-4">Source Code</h3>
            <Tabs 
              defaultValue="git-provider" 
              className="w-full"
              onValueChange={(value) => {
                setSourceType(value as "git-provider" | "existing-image");
                
                // Clear fields based on selected tab
                if (value === "git-provider") {
                  form.setValue("dockerImageUrl", "");
                  setIsDockerImageValid(null);
                } else {
                  form.setValue("gitProviderId", "");
                  form.setValue("repositoryName", "");
                  form.setValue("branch", "");
                  form.setValue("runtimeFilePath", "");
                  setRepositories([]);
                  setBranches([]);
                }
              }}
            >
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="git-provider">Git provider</TabsTrigger>
                <TabsTrigger value="existing-image">Existing Image</TabsTrigger>
              </TabsList>
              
              <TabsContent value="git-provider">
                {!hasGitProviders ? (
                  <div className="p-4 rounded-md bg-muted/50 mb-4">
                    <p className="text-sm">
                      No GitHub providers found. You need to configure a GitHub provider before creating a web service.{" "}
                      <Link href={`/dashboard/${params.organizationId}/settings/git-providers`} className="font-medium underline">
                        Configure GitHub
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="gitProviderId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Git Provider</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              field.onChange(value);
                              // Clear Docker image URL when switching to Git provider
                              form.setValue('dockerImageUrl', '');
                              // Find the selected provider and set its type
                              const provider = gitProviders.find(p => p.id === value);
                              setSelectedProviderType(provider?.type as "GITHUB" | "CUSTOM" || null);
                              // Clear repository name when changing provider
                              form.setValue('repositoryName', '');
                            }}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a Git provider" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-96 overflow-y-auto">
                              {gitProviders.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                  {provider.type === "GITHUB" ? (
                                    <span className="flex items-center gap-2">
                                      <Github className="h-4 w-4" />
                                      {provider.githubAccount?.username}
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-2">
                                      <GitBranch className="h-4 w-4" />
                                      {provider.username} {provider.url}
                                    </span>
                                  )}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="repositoryName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Repository</FormLabel>
                          {selectedProviderType === "GITHUB" ? (
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              disabled={!gitProviderId || loadingRepositories}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={loadingRepositories ? "Loading repositories..." : "Select a repository"} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="max-h-96 overflow-y-auto">
                                {repositories.map((repo) => (
                                  <SelectItem key={repo.fullName} value={repo.fullName}>
                                    {repo.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <FormControl>
                              <Input
                                placeholder="Enter repository name (e.g., username/repo)"
                                {...field}
                                disabled={!gitProviderId}
                              />
                            </FormControl>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="branch"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Branch</FormLabel>
                          {selectedProviderType === "GITHUB" ? (
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                              disabled={!repositoryName || loadingBranches}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={loadingBranches ? "Loading branches..." : "Select a branch"} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="max-h-96 overflow-y-auto">
                                {branches.map((branch) => (
                                  <SelectItem key={branch.name} value={branch.name}>
                                    {branch.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <FormControl>
                              <Input
                                placeholder="Enter branch name (e.g., main)"
                                {...field}
                                disabled={!repositoryName}
                              />
                            </FormControl>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="runtimeFilePath"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dockerfile Path (optional)</FormLabel>
                          <FormControl>
                              <Input
                                placeholder="Path to Dockerfile (e.g., ./Dockerfile or path/to/Dockerfile)"
                                {...field}
                                disabled={!branch}
                                onChange={(e) => {
                                  field.onChange(e);
                                  
                                  // Use extracted debounce function if value exists
                                  if (e.target.value && gitProviderId && repositoryName && branch) {
                                    debouncedLoadRepositoryDescription(e.target.value);
                                  }
                                }}
                              />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {!loadingRepoDescription && repoDescription !== null && !repoDescription.hasDockerfile && !repoDescription.hasProcfile && branch && (
                      <div className="p-3 rounded-md bg-red-50 border-red-200 border text-red-800 text-sm">
                        <div className="flex items-start">
                          <AlertTriangle className="h-4 w-4 mr-2 mt-0.5" />
                          <div>
                            <p className="font-medium">No Dockerfile or Procfile found</p>
                            <p className="mt-1">Your repository needs either a Dockerfile or a Procfile to build and deploy your application. Please add one of these files to your repository.</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {!loadingRepoDescription && repoDescription !== null && repoDescription.hasDockerfile && !repoDescription.hasProcfile && branch && (
                      <div className="p-3 rounded-md bg-green-50 border-green-200 border text-green-800 text-sm">
                        <div className="flex items-start">
                          <Check className="h-4 w-4 mr-2 mt-0.5" />
                          <div>
                            <p className="font-medium">Dockerfile found</p>
                            <p className="mt-1">Your repository has a Dockerfile, which will be used to build and deploy your application.</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {!loadingRepoDescription && repoDescription !== null && !repoDescription.hasDockerfile && repoDescription.hasProcfile && branch && (
                      <div className="p-3 rounded-md bg-green-50 border-green-200 border text-green-800 text-sm">
                        <div className="flex items-start">
                          <Check className="h-4 w-4 mr-2 mt-0.5" />
                          <div>
                            <p className="font-medium">Procfile found</p>
                            <p className="mt-1">Your repository has a Procfile, which will be used to deploy your application with Paketo buildpacks.</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {loadingRepoDescription && (
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Checking repository...</span>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="existing-image">
                <div>
                  <FormField
                    control={form.control}
                    name="dockerImageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Docker Image URL</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input 
                              placeholder="Enter public Docker image URL (e.g., nginx:latest)" 
                              {...field} 
                              onChange={(e) => {
                                field.onChange(e);
                                // Clear Git provider fields when entering Docker image URL
                                if (e.target.value) {
                                  form.setValue('gitProviderId', '');
                                  form.setValue('repositoryName', '');
                                  form.setValue('branch', '');
                                  form.setValue('runtimeFilePath', '');
                                }
                              }}
                              className={isDockerImageValid === false ? "border-red-500 pr-10" : ""}
                            />
                            {validatingDockerImage && (
                              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                              </div>
                            )}
                            {isDockerImageValid === true && !validatingDockerImage && (
                              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <Check className="h-4 w-4 text-green-500" />
                              </div>
                            )}
                            {isDockerImageValid === false && !validatingDockerImage && (
                              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                              </div>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                        {isDockerImageValid === false && !validatingDockerImage && (
                          <p className="text-sm text-red-500 mt-1">
                            Invalid Docker image URL. Please enter a valid image URL.
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1">
                          Enter the URL of a public Docker image to deploy directly.
                        </p>
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="border rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-medium mb-4">Environment Variables</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add environment variables that will be available to your service at runtime
            </p>
            
            <div className="space-y-4">
              {form.watch('environmentVariables')?.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground border border-dashed rounded-md">
                  No environment variables set. Click &quot;Add Variable&quot; to add one.
                </div>
              ) : (
                <div className="space-y-2">
                  {form.watch('environmentVariables')?.map((_, index) => (
                    <div key={index} className="flex gap-2">
                      <FormField
                        control={form.control}
                        name={`environmentVariables.${index}.key`}
                        render={({ field }) => (
                          <FormItem className="w-1/3 mb-0">
                            <FormControl>
                              <Input placeholder="KEY" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`environmentVariables.${index}.value`}
                        render={({ field }) => (
                          <FormItem className="flex-1 mb-0">
                            <FormControl>
                              <Textarea 
                                placeholder="VALUE" 
                                {...field} 
                                className="min-h-[40px]"
                                rows={
                                  (field.value || '').split('\n').length > 1 
                                    ? Math.min((field.value || '').split('\n').length, 5) 
                                    : 1
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        variant="outline" 
                        size="icon" 
                        type="button"
                        onClick={() => removeEnvironmentVariable(index)}
                        className="shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              <Button
                type="button"
                variant="outline"
                onClick={addEnvironmentVariable}
                className="flex items-center gap-1"
              >
                <PlusCircle className="h-4 w-4" /> Add Variable
              </Button>
              
              <div className="mt-4 text-sm text-muted-foreground">
                <p className="font-medium">Important notes:</p>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>Environment variables are encrypted at rest and exposed only to your service.</li>
                  <li>Values for keys containing &quot;password&quot;, &quot;secret&quot;, or &quot;token&quot; will be masked.</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-6 shadow-sm mt-6">
            <h3 className="text-lg font-medium mb-4">Port Settings</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure service ports that will be exposed to your application
            </p>
            
            <div className="space-y-4">
              <div className="space-y-2">
                {form.watch('portSettings')?.map((_, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <FormField
                      control={form.control}
                      name={`portSettings.${index}.servicePort`}
                      render={({ field }) => (
                        <FormItem className="w-1/3 mb-0">
                          <FormLabel className={index === 0 ? "" : "sr-only"}>Service Port</FormLabel>
                          <FormControl>
                            <Input 
                              disabled={true}
                              type="number" 
                              min="1" 
                              max="65535" 
                              placeholder="80" 
                              {...field} 
                              onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 80)}
                              value={field.value.toString()}
                            />
                          </FormControl>
                          <FormDescription className={index === 0 ? "text-xs" : "sr-only"}>
                            External port exposed to the internet
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex items-center mx-2 text-muted-foreground">
                      <span>→</span>
                    </div>
                    <FormField
                      control={form.control}
                      name={`portSettings.${index}.containerPort`}
                      render={({ field }) => (
                        <FormItem className="w-1/3 mb-0">
                          <FormLabel className={index === 0 ? "" : "sr-only"}>App Port</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              max="65535" 
                              placeholder="3000" 
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 3000)}
                              value={field.value.toString()}
                            />
                          </FormControl>
                          <FormDescription className={index === 0 ? "text-xs" : "sr-only"}>
                            Internal port where your app listens
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
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
