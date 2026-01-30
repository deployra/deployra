'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Control, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { Loader2, AlertTriangle, Check, Github, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounce } from 'use-debounce';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  getRepositories,
  getBranches,
  getRepositoryDescription,
  validateDockerImage
} from '@/lib/api';
import { Repository, Branch, GitProvider, RepositoryDescription } from '@/lib/models';
import { ApplicationFormValues } from './types';

interface SourceCodeSectionProps {
  control: Control<ApplicationFormValues>;
  setValue: UseFormSetValue<ApplicationFormValues>;
  watch: UseFormWatch<ApplicationFormValues>;
  gitProviders: GitProvider[];
  hasError?: boolean;
}

export function SourceCodeSection({
  control,
  setValue,
  watch,
  gitProviders,
  hasError = false,
}: SourceCodeSectionProps) {
  const params = useParams();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [repoDescription, setRepoDescription] = useState<RepositoryDescription | null>(null);
  const [loadingRepoDescription, setLoadingRepoDescription] = useState(false);
  const [validatingDockerImage, setValidatingDockerImage] = useState(false);
  const [isDockerImageValid, setIsDockerImageValid] = useState<boolean | null>(null);
  const [sourceType, setSourceType] = useState<"git-provider" | "existing-image">("git-provider");
  const [selectedProviderType, setSelectedProviderType] = useState<"GITHUB" | "CUSTOM" | null>(null);

  const gitProviderId = watch('gitProviderId');
  const repositoryName = watch('repositoryName');
  const branch = watch('branch');
  const runtimeFilePath = watch('runtimeFilePath');
  const dockerImageUrl = watch('dockerImageUrl');
  const dockerUsername = watch('dockerUsername');
  const dockerPassword = watch('dockerPassword');

  // Debounced values for CUSTOM providers
  const [debouncedRepositoryName] = useDebounce(repositoryName, 200);
  const [debouncedBranch] = useDebounce(branch, 500);
  const [debouncedRuntimeFilePath] = useDebounce(runtimeFilePath, 200);
  const [debouncedDockerImageUrl] = useDebounce(dockerImageUrl, 200);
  const [debouncedDockerUsername] = useDebounce(dockerUsername, 200);
  const [debouncedDockerPassword] = useDebounce(dockerPassword, 200);

  const hasGitProviders = gitProviders.length > 0;

  // Load repository description
  const loadRepositoryDescription = useCallback(async (path?: string) => {
    if (!gitProviderId || !repositoryName || !branch) {
      setRepoDescription(null);
      return;
    }

    try {
      setLoadingRepoDescription(true);
      const description = await getRepositoryDescription(
        gitProviderId,
        repositoryName,
        branch,
        path || runtimeFilePath
      );
      setRepoDescription(description);
    } catch (error) {
      console.error("Failed to load repository description:", error);
      setRepoDescription(null);
    } finally {
      setLoadingRepoDescription(false);
    }
  }, [gitProviderId, repositoryName, branch, runtimeFilePath]);

  // Load branches function
  const loadBranches = useCallback(async () => {
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
  }, [gitProviderId, repositoryName]);



  // Load repositories when git provider changes
  useEffect(() => {
    const loadRepositories = async () => {
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
    };

    loadRepositories();
    setValue('repositoryName', '');
    setValue('branch', '');
    setRepoDescription(null);
  }, [gitProviderId, setValue]);

  // Reset branches when repository changes
  useEffect(() => {
    setBranches([]);
  }, [repositoryName]);

  // Load branches when repository changes
  useEffect(() => {
    if (selectedProviderType === "GITHUB" && gitProviderId && repositoryName) {
      // For GitHub providers, load branches immediately since it's a select change
      loadBranches();
      setValue('branch', '');
      setRepoDescription(null);
    }
  }, [gitProviderId, repositoryName, selectedProviderType, setValue, loadBranches]);

  // Load branches for CUSTOM providers (debounced)
  useEffect(() => {
    if (selectedProviderType === "CUSTOM" && gitProviderId && debouncedRepositoryName) {
      loadBranches();
      setValue('branch', '');
      setRepoDescription(null);
    }
  }, [gitProviderId, debouncedRepositoryName, selectedProviderType, setValue, loadBranches]);

  // Clear branches when repository is cleared for CUSTOM providers
  useEffect(() => {
    if (selectedProviderType === "CUSTOM" && !repositoryName) {
      setBranches([]);
      setValue('branch', '');
      setRepoDescription(null);
    }
  }, [repositoryName, selectedProviderType, setValue]);

  // Load repository description when branch changes
  useEffect(() => {
    if (selectedProviderType === "GITHUB" && gitProviderId && repositoryName && branch) {
      // For GitHub providers, load repository description immediately since it's a select change
      loadRepositoryDescription();
    }
  }, [selectedProviderType, gitProviderId, repositoryName, branch, loadRepositoryDescription]);

  // Load repository description for CUSTOM providers (debounced)
  useEffect(() => {
    if (selectedProviderType === "CUSTOM" && gitProviderId && debouncedRepositoryName && debouncedBranch) {
      loadRepositoryDescription();
    }
  }, [gitProviderId, debouncedRepositoryName, debouncedBranch, selectedProviderType, loadRepositoryDescription]);

  // Load repository description when runtime file path changes (debounced)
  useEffect(() => {
    if (gitProviderId && debouncedRepositoryName && debouncedBranch && debouncedRuntimeFilePath) {
      loadRepositoryDescription(debouncedRuntimeFilePath);
    }
  }, [gitProviderId, debouncedRepositoryName, debouncedBranch, debouncedRuntimeFilePath, loadRepositoryDescription]);

  // Reset repo description when branch changes
  useEffect(() => {
    setRepoDescription(null);
  }, [branch]);

  // Validate Docker image URL (debounced)
  useEffect(() => {
    const validateImage = async () => {
      if (!debouncedDockerImageUrl) {
        setIsDockerImageValid(null);
        return;
      }
      
      try {
        setValidatingDockerImage(true);
        const isValid = await validateDockerImage(
          debouncedDockerImageUrl,
          debouncedDockerUsername || undefined,
          debouncedDockerPassword || undefined
        );
        setIsDockerImageValid(isValid);
      } catch (error) {
        console.error("Failed to validate Docker image:", error);
        setIsDockerImageValid(false);
      } finally {
        setValidatingDockerImage(false);
      }
    };
    
    if (debouncedDockerImageUrl) {
      validateImage();
    }
  }, [debouncedDockerImageUrl, debouncedDockerUsername, debouncedDockerPassword]);



  const containerClass = cn(
    "border rounded-lg p-6 shadow-sm source-code-section",
    { "border-red-500": hasError }
  );

  return (
    <div className={containerClass}>
      <h3 className="text-lg font-medium mb-4">Source Code</h3>
      <Tabs 
        defaultValue="git-provider" 
        className="w-full"
        onValueChange={(value) => {
          setSourceType(value as "git-provider" | "existing-image");
          
          // Clear fields based on selected tab
          if (value === "git-provider") {
            setValue("dockerImageUrl", "");
            setIsDockerImageValid(null);
          } else {
            setValue("gitProviderId", "");
            setValue("repositoryName", "");
            setValue("branch", "");
            setValue("runtimeFilePath", "");
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
                control={control}
                name="gitProviderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Git Provider</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value);
                        setValue('dockerImageUrl', '');
                        const provider = gitProviders.find(p => p.id === value);
                        setSelectedProviderType(provider?.type as "GITHUB" | "CUSTOM" || null);
                        setValue('repositoryName', '');
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
                control={control}
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
                control={control}
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
                control={control}
                name="runtimeFilePath"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dockerfile Path (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Path to Dockerfile (e.g., ./Dockerfile or path/to/Dockerfile)"
                        {...field}
                        disabled={!branch}

                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Repository status indicators */}
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
          <div className="space-y-4">
            <FormField
              control={control}
              name="dockerImageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Docker Image URL</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input 
                        placeholder="Enter Docker image URL (e.g., nginx:latest or username/private-repo:tag)" 
                        {...field} 
                        onChange={(e) => {
                          field.onChange(e);
                          if (e.target.value) {
                            setValue('gitProviderId', '');
                            setValue('repositoryName', '');
                            setValue('branch', '');
                            setValue('runtimeFilePath', '');
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
                      Invalid Docker image name. Please enter a valid image name.
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter the name of a Docker Hub image to deploy directly. For private images, provide credentials below.
                  </p>
                </FormItem>
              )}
            />

            {/* Docker Hub Credentials for Private Images */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h4 className="text-sm font-medium mb-3">Docker Hub Credentials (Optional)</h4>
              <p className="text-xs text-muted-foreground mb-4">
                Provide your Docker Hub credentials to access private images. Leave empty for public images.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={control}
                  name="dockerUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Docker Hub Username</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter Docker Hub username" 
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            // Clear git provider fields when Docker credentials are entered
                            if (e.target.value) {
                              setValue('gitProviderId', '');
                              setValue('repositoryName', '');
                              setValue('branch', '');
                              setValue('runtimeFilePath', '');
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="dockerPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Docker Hub Password/Token</FormLabel>
                      <FormControl>
                        <Input 
                          type="password"
                          placeholder="Enter Docker Hub password or access token" 
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            // Clear git provider fields when Docker credentials are entered
                            if (e.target.value) {
                              setValue('gitProviderId', '');
                              setValue('repositoryName', '');
                              setValue('branch', '');
                              setValue('runtimeFilePath', '');
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <p className="text-xs text-muted-foreground mt-3">
                💡 <strong>Tip:</strong> For better security, use a Docker Hub access token instead of your password. 
                You can create one in your Docker Hub account settings.
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
