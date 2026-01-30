"use client"

import { GitBranch, Github, Trash2, CircleSlash, Loader2, Plus } from "lucide-react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  getGitProviders, 
  getGithubAccounts, 
  deleteGitProvider,
  createGitProvider,
} from "@/lib/api"
import { GithubAccount, GitProvider } from "@/lib/models"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { GitProviderType } from "@prisma/client"

export default function GitProvidersPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const organizationId = params.organizationId as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [gitProviders, setGitProviders] = useState<GitProvider[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [githubAccounts, setGithubAccounts] = useState<GithubAccount[]>([]);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customGitForm, setCustomGitForm] = useState({
    url: "",
    username: "",
    password: ""
  });

  // Function to load providers data
  const loadProviders = async () => {
    setIsLoading(true);
    
    try {
      const providers = await getGitProviders(organizationId);
      setGitProviders(providers);
    } catch (error) {
      console.error("Error loading providers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to load GitHub accounts
  const loadGithubAccounts = async () => {
    setIsLoadingAccounts(true);
    
    try {
      const accounts = await getGithubAccounts(organizationId);
      setGithubAccounts(accounts);
    } catch (error) {
      console.error("Error loading GitHub accounts:", error);
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  // Function to create GitHub provider
  const handleCreateGitProvider = async (githubAccountId: string) => {
    try {
      // Redirect to GitHub App installation URL
      const githubAppName = process.env.NEXT_PUBLIC_GITHUB_APP_NAME;
      
      if (!githubAppName) {
        return false;
      }
      
      // GitHub app installation URL with callback to our unified github callback endpoint
      const callbackUrl = `${window.location.origin}/api/callback/github`;
      const encodedCallback = encodeURIComponent(callbackUrl);
      const stateParam = `${organizationId}:${githubAccountId}`;
      
      const installUrl = `https://github.com/apps/${githubAppName}/installations/new?state=${stateParam}&redirect_uri=${encodedCallback}`;
      window.location.href = installUrl;
      return true;
    } catch (error) {
      console.error("Failed to start GitHub app installation:", error);
      return false;
    }
  };

  // Function to handle provider deletion
  const handleDeleteGitProvider = async (providerId: string) => {
    try {
      setIsDeleting(true);
      await deleteGitProvider(providerId);
      loadProviders();
      setDeleteDialogOpen(false);
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to delete Git provider");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  // Function to handle custom Git provider creation
  const handleCreateCustomGitProvider = async () => {
    if (!customGitForm.url || !customGitForm.username || !customGitForm.password) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      setIsCreatingCustom(true);
      await createGitProvider({
        type: GitProviderType.CUSTOM,
        organizationId,
        url: customGitForm.url,
        username: customGitForm.username,
        password: customGitForm.password
      });
      
      toast.success("Custom Git provider added successfully");
      setCustomGitForm({ url: "", username: "", password: "" });
      setIsDialogOpen(false);
      loadProviders();
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("Failed to create custom Git provider");
      }
    } finally {
      setIsCreatingCustom(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, [organizationId]);

  useEffect(() => {
    // Check for success/error messages in URL
    const success = searchParams.get("success");
    const accountId = searchParams.get("accountId");
    const installationSuccess = searchParams.get("installation_success");

    if (success && accountId) {
      // Clear query params
      router.replace(`/dashboard/${organizationId}/settings/git-providers`);
      
      // Refresh data
      loadProviders();
    }

    if (installationSuccess) {
      // Clear query params
      router.replace(`/dashboard/${organizationId}/settings/git-providers`);
      
      // Refresh data
      loadProviders();
    }
  }, [searchParams, organizationId]);

  const handleGitHubAuth = () => {
    const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
    // Use window.location.origin to get the current base URL dynamically
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    let redirectUri = `${apiUrl}/api/callback/github`;
    
    // Add organization ID to the redirect URI
    redirectUri += `?organizationId=${organizationId}`;
    
    const scope = "repo admin:repo_hook";
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
    window.location.href = githubAuthUrl;
  };

  return (
    <div className="container mb-10 space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Git Providers"
          description="Connect your Git providers to sync repositories"
          icon={GitBranch}
        />
        {!isLoading && gitProviders.length > 0 && (          
          <Button onClick={() => {
            loadGithubAccounts();
            setIsDialogOpen(true);
          }}>
            <Plus className="h-4 w-4" />
            Add Provider
          </Button>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Git Provider</DialogTitle>
            <DialogDescription>
              Choose how you want to connect your Git repositories.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="github" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="github">GitHub</TabsTrigger>
              <TabsTrigger value="custom">Custom Git</TabsTrigger>
            </TabsList>
            <TabsContent value="github" className="space-y-4">
              {isLoadingAccounts ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center space-x-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-[200px]" />
                        <Skeleton className="h-4 w-[150px]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : githubAccounts.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-muted-foreground mb-4">No GitHub accounts found.</p>
                  <Button onClick={handleGitHubAuth}>
                    <Github className="h-4 w-4 mr-2" />
                    Connect GitHub Account
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {githubAccounts.map((account) => (
                    <div key={account.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={account.avatarUrl || undefined} alt={account.username} />
                          <AvatarFallback>{account.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{account.username}</p>
                          <p className="text-sm text-muted-foreground">{account.email}</p>
                        </div>
                      </div>
                      <Button 
                        onClick={() => handleCreateGitProvider(account.id)}
                        size="sm"
                      >
                        Connect
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="custom" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="git-url">Git Server URL</Label>
                  <Input
                    id="git-url"
                    placeholder="https://git.example.com"
                    value={customGitForm.url}
                    onChange={(e) => setCustomGitForm(prev => ({ ...prev, url: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="git-username">Username</Label>
                  <Input
                    id="git-username"
                    placeholder="Git server username"
                    value={customGitForm.username}
                    onChange={(e) => setCustomGitForm(prev => ({ ...prev, username: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="git-password">Password/Token</Label>
                  <Input
                    id="git-password"
                    type="password"
                    placeholder="Password or personal access token"
                    value={customGitForm.password}
                    onChange={(e) => setCustomGitForm(prev => ({ ...prev, password: e.target.value }))}
                  />
                </div>
                <Button 
                  onClick={handleCreateCustomGitProvider}
                  disabled={isCreatingCustom || !customGitForm.url || !customGitForm.username || !customGitForm.password}
                  className="w-full"
                >
                  {isCreatingCustom && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Add Custom Git Provider
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <Card>
          <CardContent className="py-4">
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between rounded-md">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div>
                      <Skeleton className="h-5 w-32 mb-1" />
                      <Skeleton className="h-3 w-16 mb-1" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : gitProviders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center">
            <CircleSlash className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">No Git providers configured yet</p>
            <p className="text-sm text-muted-foreground mb-4">
            Connect a Git provider to get started.
            </p>
            <Button onClick={() => {
              loadGithubAccounts();
              setIsDialogOpen(true);
            }}>
              <Plus className="h-4 w-4" />
              Add Git Provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <div className="space-y-4">
              {gitProviders.map((provider: GitProvider) => (
                <div key={provider.id} className="flex items-center justify-between rounded-md">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {provider.type === GitProviderType.GITHUB && provider.githubAccount?.avatarUrl ? (
                        <AvatarImage src={provider.githubAccount.avatarUrl} alt={provider.githubAccount.username} />
                      ) : (
                        <AvatarFallback>
                          {provider.type === GitProviderType.GITHUB && provider.githubAccount
                            ? provider.githubAccount.username?.substring(0, 2).toUpperCase()
                            : provider.username?.substring(0, 2).toUpperCase() || 'CG'
                          }
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div>
                      <p className="font-medium">
                        {provider.type === GitProviderType.GITHUB && provider.githubAccount 
                          ? provider.githubAccount.username 
                          : provider.username || 'Custom Git Provider'}
                      </p>
                      <div className="flex items-center gap-2">
                        {provider.type === GitProviderType.GITHUB ? (
                          <span className="text-xs rounded-full flex items-center gap-1">
                            <Github className="h-3 w-3" />
                            GitHub
                          </span>
                        ) : (
                          <span className="text-xs rounded-full flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            Custom Git
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {provider.type === GitProviderType.CUSTOM && provider.url && (
                          <span className="block">{provider.url}</span>
                        )}
                        Connected on {new Date(provider.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    disabled={isDeleting}
                    onClick={() => {
                      setProviderToDelete(provider.id);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Provider Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Git Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove this Git provider? This will remove access to all repositories
              from this provider.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => providerToDelete && handleDeleteGitProvider(providerToDelete)}
              variant="destructive" 
              size="sm" 
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
