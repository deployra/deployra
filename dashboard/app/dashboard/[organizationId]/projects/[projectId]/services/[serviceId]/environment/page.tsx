"use client";

import { useState, useEffect } from 'react';
import { LayersIcon, PlusCircle, Eye, Loader2, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  getServiceEnvironmentVariables, 
  getEnvironmentVariableValue,
  updateEnvironmentVariables,
  deleteEnvironmentVariables
} from '@/lib/api';
import { useParams } from 'next/navigation';

// Regex pattern for validating environment variable keys
const ENV_KEY_REGEX = /^[-._a-zA-Z0-9]+$/;

interface EnvironmentVariable {
  key: string;
  value: string;
  masked: boolean;
  newAdded: boolean;
  updated: boolean;
}

export default function ServiceEnvironmentPage() {
  const params = useParams();
  const serviceId = params.serviceId as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingValues, setLoadingValues] = useState<Record<string, boolean>>({});

  // Environment variables state
  const [environmentVars, setEnvironmentVars] = useState<EnvironmentVariable[]>([]);
  const [originalEnvironmentVars, setOriginalEnvironmentVars] = useState<{key: string, value: string}[]>([]);
  const [deletedKeys, setDeletedKeys] = useState<string[]>([]);
  const [keyErrors, setKeyErrors] = useState<Record<number, string>>({});

  // Function to fetch environment variables
  const fetchEnvironmentVariables = async () => {
    setLoading(true);
    try {
      const response = await getServiceEnvironmentVariables(serviceId);
      
      // Transform API response to our enhanced format
      const formattedVars = response.map(variable => ({
        key: variable.key,
        value: variable.value, // This will be masked (*** format) from the API
        masked: true,
        newAdded: false,
        updated: false
      }));
      
      setEnvironmentVars(formattedVars);
      setOriginalEnvironmentVars(response);
      setDeletedKeys([]);
      setKeyErrors({});
    } catch (error) {
      console.error('Error fetching environment variables:', error);
      toast.error('Failed to load environment variables');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchEnvironmentVariables();
  }, [serviceId]);

  // Add new environment variable
  const addEnvironmentVar = () => {
    setEnvironmentVars([
      ...environmentVars, 
      { 
        key: '', 
        value: '', 
        masked: false, 
        newAdded: true, 
        updated: false 
      }
    ]);
  };
  
  // Validate environment variable key
  const validateKey = (key: string): string | null => {
    if (!key.trim()) {
      return "Key is required";
    }
    if (!ENV_KEY_REGEX.test(key)) {
      return "Key must only contain letters, numbers, hyphens, underscores, and periods";
    }
    return null;
  };

  // Update environment variable key
  const updateEnvironmentVarKey = (index: number, newKey: string) => {
    const updatedVars = [...environmentVars];
    updatedVars[index] = {
      ...updatedVars[index],
      key: newKey,
      updated: !updatedVars[index].newAdded
    };
    setEnvironmentVars(updatedVars);

    // Validate the key
    const error = validateKey(newKey);
    setKeyErrors(prev => {
      const updated = { ...prev };
      if (error) {
        updated[index] = error;
      } else {
        delete updated[index];
      }
      return updated;
    });
  };

  // Update environment variable value
  const updateEnvironmentVarValue = (index: number, newValue: string) => {
    const updatedVars = [...environmentVars];
    updatedVars[index] = {
      ...updatedVars[index],
      value: newValue,
      updated: !updatedVars[index].newAdded
    };
    setEnvironmentVars(updatedVars);
  };
  
  // Remove environment variable
  const removeEnvironmentVar = (index: number) => {
    const envVar = environmentVars[index];
    
    // If it's not a new variable, add it to deletedKeys
    if (!envVar.newAdded && envVar.key) {
      setDeletedKeys([...deletedKeys, envVar.key]);
    }
    
    // Remove it from the current state
    const updatedVars = [...environmentVars];
    updatedVars.splice(index, 1);
    setEnvironmentVars(updatedVars);
  };
  
  // View the real value of an environment variable
  const viewEnvironmentVarValue = async (index: number) => {
    const envVar = environmentVars[index];
    if (!envVar.key || !envVar.masked) return;
    
    // Set loading state for this variable
    setLoadingValues(prev => ({ ...prev, [envVar.key]: true }));
    
    try {
      const response = await getEnvironmentVariableValue(serviceId, envVar.key);
      
      // Update the variable with its real value and mark as unmasked
      const updatedVars = [...environmentVars];
      updatedVars[index] = {
        ...updatedVars[index],
        value: response.value,
        masked: false
      };
      
      setEnvironmentVars(updatedVars);
    } catch (error) {
      console.error('Error fetching environment variable value:', error);
      toast.error(`Failed to load value for ${envVar.key}`);
    } finally {
      setLoadingValues(prev => ({ ...prev, [envVar.key]: false }));
    }
  };
  
  // Check if there are any changes to save
  const hasEnvironmentVarsChanged = () => {
    // Check for deleted keys
    if (deletedKeys.length > 0) return true;

    // Check for new or updated variables
    return environmentVars.some(variable =>
      variable.newAdded ||
      variable.updated
    );
  };

  // Check if there are any validation errors
  const hasValidationErrors = () => {
    return Object.keys(keyErrors).length > 0;
  };
  
  // Save all environment variable changes
  const handleSaveEnvironment = async () => {
    if (!hasEnvironmentVarsChanged()) return;
    
    setSaving(true);
    
    try {
      // Prepare variables to update (new or modified)
      const variablesToUpdate = environmentVars
        .filter(variable => 
          (variable.newAdded || variable.updated) && 
          variable.key.trim() !== "" && 
          !variable.masked // Only include variables where we have the real value
        )
        .map(variable => ({
          key: variable.key,
          value: variable.value
        }));
      
      // Process updates first if we have any
      if (variablesToUpdate.length > 0) {
        await updateEnvironmentVariables(serviceId, variablesToUpdate);
      }
      
      // Process deletions if we have any
      if (deletedKeys.length > 0) {
        await deleteEnvironmentVariables(serviceId, deletedKeys);
      }
      
      // Refresh the environment variables to get the latest state
      await fetchEnvironmentVariables();
      
      toast.success('Environment variables updated successfully');
    } catch (error) {
      console.error('Error saving environment variables:', error);
      toast.error('Failed to save environment variables');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader 
        title="Environment Variables" 
        description="Manage environment variables for your service."
        icon={LayersIcon}
      />
      
      <Card>
        <CardHeader>
          <CardTitle>Service Environment Variables</CardTitle>
          <CardDescription>
            Add, edit, or remove environment variables for your service. 
            These variables will be available to your service at runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div>
              {environmentVars.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <p>No environment variables have been configured yet.</p>
                  <p>Click the "Add Variable" button to create one.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {environmentVars.map((envVar, index) => (
                    <div
                      key={`env-var-${index}`}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex flex-row gap-2 items-start">
                        <div className="relative w-1/3">
                          <Input
                            value={envVar.key}
                            onChange={(e) => updateEnvironmentVarKey(index, e.target.value)}
                            placeholder="KEY"
                            className={`w-full pr-8 ${keyErrors[index] ? 'border-red-500' : ''}`}
                            readOnly={!envVar.newAdded}
                          />
                          {!envVar.newAdded && (
                            <Lock className="h-3 w-3 absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                          )}
                        </div>
                      <Textarea
                        value={envVar.value}
                        onChange={(e) => updateEnvironmentVarValue(index, e.target.value)}
                        placeholder="VALUE"
                        className="flex-1 min-h-[40px]"
                        disabled={envVar.masked}
                        rows={
                          (envVar.value || '').split('\n').length > 1 
                            ? Math.min((envVar.value || '').split('\n').length, 5) 
                            : 1
                        }
                      />
                      {!envVar.newAdded && envVar.masked && (
                        <Button 
                          variant="outline" 
                          size="icon" 
                          onClick={() => viewEnvironmentVarValue(index)}
                          disabled={!envVar.key.trim() || loadingValues[envVar.key]}
                          className="shrink-0 h-10"
                          title="View value"
                        >
                          {loadingValues[envVar.key] ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => removeEnvironmentVar(index)}
                          className="shrink-0 h-10"
                          title="Remove variable"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {keyErrors[index] && (
                        <p className="text-sm text-red-500 ml-0">{keyErrors[index]}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex flex-col sm:flex-row justify-between gap-4 mt-6">
                <Button 
                  variant="outline" 
                  onClick={addEnvironmentVar}
                  className="flex items-center gap-1"
                >
                  <PlusCircle className="h-4 w-4" /> Add Variable
                </Button>
                
                <Button
                  onClick={handleSaveEnvironment}
                  disabled={saving || !hasEnvironmentVarsChanged() || hasValidationErrors()}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save Environment Variables
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
