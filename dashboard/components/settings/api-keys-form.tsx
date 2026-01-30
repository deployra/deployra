'use client';

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { formatDistanceToNow } from "date-fns";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createApiKey, getApiKeys, deleteApiKey } from "@/lib/api";
import { ApiKey } from "@/lib/models";

// Schema for API key creation
const apiKeyFormSchema = z.object({
  name: z.string().min(3, 'API key name must be at least 3 characters.').max(50, 'API key name must be at most 50 characters.'),
});

export function ApiKeysForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Form for creating new API keys
  const form = useForm<z.infer<typeof apiKeyFormSchema>>({
    resolver: zodResolver(apiKeyFormSchema),
    defaultValues: {
      name: '',
    },
  });

  // Load API keys on component mount
  useEffect(() => {
    fetchApiKeys();
  }, []);

  // Fetch the user's API keys
  const fetchApiKeys = async () => {
    try {
      setIsLoading(true);
      const apiKeys = await getApiKeys();
      setApiKeys(apiKeys);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle creating a new API key
  const onCreateKey = async (values: z.infer<typeof apiKeyFormSchema>) => {
    try {
      const apiKey = await createApiKey(values);
      setNewApiKey(apiKey.key);
      await fetchApiKeys();
      form.reset();
    } catch (error) {
      console.error('Failed to create API key:', error);
    }
  };

  // Handle deleting an API key
  const handleDeleteKey = async (id: string) => {
    try {
      setIsDeleting(id);
      await deleteApiKey(id);
      setApiKeys(apiKeys.filter((apiKey) => apiKey.id !== id));
    } catch (error) {
      console.error('Failed to delete API key:', error);
    } finally {
      setIsDeleting(null);
    }
  };

  // Format relative time for display
  const formatRelativeTime = (date: string | null) => {
    if (!date) return 'Never';
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch (e) {
      return 'Unknown';
    }
  };

  return (
    <div className="space-y-6">
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>Manage your API keys for programmatic access</CardDescription>
            </div>
            <DialogTrigger asChild>
              <Button onClick={() => {
                setNewApiKey(null);
                form.reset();
              }}>
                <Plus className="h-4 w-4" /> Create Key
              </Button>
            </DialogTrigger>
          </CardHeader>
          <CardContent className="p-4">
            {isLoading ? (
              <div className="space-y-4">
                {Array(3).fill(0).map((_, i) => (
                  <div key={i} className="border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center">
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-[120px]" />
                        <Skeleton className="h-4 w-[200px]" />
                      </div>
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : apiKeys.length > 0 ? (
              <div className="space-y-4">
                {apiKeys.map((apiKey) => (
                  <div key={apiKey.id} className="border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-col space-y-3">
                      <div className="flex items-center gap-4">
                        <div className="w-1/8">
                          <h4 className="font-medium truncate">{apiKey.name}</h4>
                        </div>
                        <div className="flex-1 font-mono text-xs bg-muted p-2 rounded relative">
                          <span className="truncate block pr-8">{apiKey.key}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
                            onClick={() => {
                              navigator.clipboard.writeText(apiKey.key || '');
                              toast.success("API key copied to clipboard");
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteKey(apiKey.id)}
                            disabled={isDeleting === apiKey.id}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            {isDeleting === apiKey.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Created: {formatRelativeTime(apiKey.createdAt)}</span>
                        <span>Last used: {formatRelativeTime(apiKey.lastUsedAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-2">
                No API keys found. Create one to get started.
              </div>
            )}
          </CardContent>
        </Card>
        
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New API Key</DialogTitle>
            <DialogDescription>
              Create a new API key to authenticate your applications. Note that you'll only be shown the key once.
            </DialogDescription>
          </DialogHeader>
          
          {newApiKey ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Copy your API key now. You won't be able to see it again.
              </p>
              <div className="font-mono text-xs bg-muted p-2 rounded relative">
                <span className="truncate block pr-8">{newApiKey}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(newApiKey || '');
                    toast.success("API key copied to clipboard");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <DialogFooter>
                <Button 
                  onClick={() => {
                    setNewApiKey(null);
                    setIsDialogOpen(false);
                  }}
                >
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCreateKey)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Development API Key" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create Key
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
