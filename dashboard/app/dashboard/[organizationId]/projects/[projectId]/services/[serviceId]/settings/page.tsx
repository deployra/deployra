"use client";

import { useState, useEffect } from 'react';
import { Settings2, Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  getService, 
  updateServiceSettings, 
  deleteService,
  getInstanceTypeGroups,
} from '@/lib/api';
import { Service, InstanceType, InstanceTypeGroup } from '@/lib/models';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'example.com';
const CNAME_TARGET = process.env.NEXT_PUBLIC_CNAME_TARGET || 'cname.example.com';

export default function ServiceSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const serviceId = params.serviceId as string;
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmServiceName, setConfirmServiceName] = useState('');

  // Basic settings
  const [serviceNameState, setServiceNameState] = useState('');
  const [serviceNameLoading, setServiceNameLoading] = useState(false);
  const [serviceNameEditing, setServiceNameEditing] = useState(false);

  // Custom domain state
  const [customDomainState, setCustomDomainState] = useState('');
  const [customDomainLoading, setCustomDomainLoading] = useState(false);
  const [customDomainVisible, setCustomDomainVisible] = useState(false);

  // Health check path state
  const [healthCheckPathState, setHealthCheckPathState] = useState('');
  const [healthCheckPathLoading, setHealthCheckPathLoading] = useState(false);
  const [healthCheckPathEditing, setHealthCheckPathEditing] = useState(false);

  // Auto deploy state
  const [autoDeployEnabledState, setAutoDeployEnabledState] = useState(false);
  const [autoDeployLoading, setAutoDeployLoading] = useState(false);
  const [autoDeployEditing, setAutoDeployEditing] = useState(false);

  // Instance type state
  const [instanceTypeGroups, setInstanceTypeGroups] = useState<InstanceTypeGroup[]>([]);
  const [instanceTypeLoading, setInstanceTypeLoading] = useState(false);
  const [selectedInstanceTypeId, setSelectedInstanceTypeId] = useState('');
  const [pendingInstanceTypeId, setPendingInstanceTypeId] = useState<string | null>(null);
  const [selectedInstanceType, setSelectedInstanceType] = useState<InstanceType | null>(null);
  const [instanceTypeGroupsLoading, setInstanceTypeGroupsLoading] = useState(false);
  const [instanceTypeConfirmationOpen, setInstanceTypeConfirmationOpen] = useState(false);

  // Storage capacity state
  const [storageCapacity, setStorageCapacity] = useState<number>(0);
  const [newStorageCapacity, setNewStorageCapacity] = useState<number>(0);
  const [storageCapacityLoading, setStorageCapacityLoading] = useState(false);
  const [storageCapacityEditing, setStorageCapacityEditing] = useState(false);
  const [storageCapacityConfirmationOpen, setStorageCapacityConfirmationOpen] = useState(false);

  // Dockerfile path state
  const [runtimeFilePath, setRuntimeFilePath] = useState<string>("");

  // Port settings state
  const [portSettings, setPortSettings] = useState<{ servicePort: number; containerPort: number }[]>([]);
  const [portSettingsEditing, setPortSettingsEditing] = useState(false);
  const [portSettingsLoading, setPortSettingsLoading] = useState(false);

  // DNS configuration dialog state
  const [dnsConfigDialogOpen, setDnsConfigDialogOpen] = useState(false);

  // Function to fetch service details
  const fetchService = async () => {
    try {
      const serviceData = await getService(serviceId);
      setService(serviceData);
      setServiceNameState(serviceData.name);
      setHealthCheckPathState(serviceData.healthCheckPath || '');
      setCustomDomainState(serviceData.customDomain || '');
      setAutoDeployEnabledState(serviceData.autoDeployEnabled || false);
      setRuntimeFilePath(serviceData.runtimeFilePath || '');
      
      // Set port settings if available
      if (serviceData.ports && serviceData.ports.length > 0) {
        setPortSettings(serviceData.ports.map(port => ({
          servicePort: port.servicePort,
          containerPort: port.containerPort
        })));
      } else {
        // Default port settings
        if (serviceData.serviceTypeId === 'web' || serviceData.serviceTypeId === 'private') {
          setPortSettings([{ servicePort: 80, containerPort: 3000 }]);
        }
      }
      
      // Set storage capacity if available in the service data
      if (serviceData.storageCapacity) {
        setStorageCapacity(serviceData.storageCapacity);
        setNewStorageCapacity(serviceData.storageCapacity);
      }

      // Load instance type groups if service has a service type
      if (serviceData.serviceTypeId) {
        if (serviceData.instanceType?.id) {
          setSelectedInstanceTypeId(serviceData.instanceType.id);
          setPendingInstanceTypeId(null);
        }
        
        setInstanceTypeGroupsLoading(true);
        try {
          const groups = await getInstanceTypeGroups(serviceData.serviceTypeId);
          setInstanceTypeGroups(groups);
          
          // Find the selected instance type
          if (serviceData.instanceType?.id) {
            for (const group of groups) {
              const foundType = group.instanceTypes.find(type => type.id === serviceData.instanceType.id);
              if (foundType) {
                setSelectedInstanceType(foundType);
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error loading instance type groups:', error);
          toast.error('Failed to load instance types');
        } finally {
          setInstanceTypeGroupsLoading(false);
        }
      }
    } catch (error) {
      console.error('Error fetching service:', error);
      toast.error('Failed to load service details');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchService();
  }, [serviceId]);
  
  // Save changes for the current field
  const saveServiceName = async () => {
    if (!serviceNameEditing) return;
    
    try {
      setServiceNameLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { name: serviceNameState });
      setService(updatedService);
      setServiceNameEditing(false);
      toast.success('Service settings updated');
    } catch (error) {
      console.error('Error updating service name:', error);
      toast.error('Failed to update service name');
    } finally {
      setServiceNameLoading(false);
    }
  };
  
  // Save changes for the current field
  const saveCustomDomain = async () => {
    try {
      setCustomDomainLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { customDomain: customDomainState });
      setService(updatedService);
      setCustomDomainVisible(false);
      toast.success('Service settings updated');
    } catch (error) {
      console.error('Error updating service custom domain:', error);
      toast.error('Failed to update service custom domain');
    } finally {
      setCustomDomainLoading(false);
    }
  };

  const removeCustomDomain = async () => {
    try {
      setCustomDomainLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { customDomain: null });
      setService(updatedService);
      setCustomDomainVisible(false);
      setCustomDomainState('');
      toast.success('Custom domain removed');
    } catch (error) {
      console.error('Error removing custom domain:', error);
      toast.error('Failed to remove custom domain');
    } finally {
      setCustomDomainLoading(false);
    }
  };

  const saveHealthCheckPath = async () => {
    try {
      setHealthCheckPathLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { healthCheckPath: healthCheckPathState });
      setService(updatedService);
      setHealthCheckPathEditing(false);
      toast.success('Service settings updated');
    } catch (error) {
      console.error('Error updating service health check path:', error);
      toast.error('Failed to update service health check path');
    } finally {
      setHealthCheckPathLoading(false);
    }
  };
  
  const saveAutoDeploy = async () => {
    try {
      setAutoDeployLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { autoDeployEnabled: autoDeployEnabledState });
      setService(updatedService);
      setAutoDeployEditing(false);
      toast.success('Service settings updated');
    } catch (error) {
      console.error('Error updating service auto deploy:', error);
      toast.error('Failed to update service auto deploy');
    } finally {
      setAutoDeployLoading(false);
    }
  };
  
  // Save instance type changes
  const saveInstanceType = async (instanceTypeId: string) => {
    if (!service || instanceTypeId === service.instanceType?.id) return;
    
    try {
      setInstanceTypeLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { instanceTypeId });
      setService(updatedService);
      toast.success('Instance type updated successfully');
      
      // Update the selected instance type ID and object
      // setSelectedInstanceTypeId(instanceTypeId);
      
      for (const group of instanceTypeGroups) {
        const foundType = group.instanceTypes.find((type: InstanceType) => type.id === instanceTypeId);
        if (foundType) {
          setSelectedInstanceType(foundType);
          break;
        }
      }
      
      // Fetch the latest service data to ensure we have the most up-to-date state
      try {
        const refreshedService = await getService(serviceId);
        setService(refreshedService);
        
        // Ensure the selected instance type ID is updated with the refreshed data
        if (refreshedService.instanceType?.id) {
          setSelectedInstanceTypeId(refreshedService.instanceType.id);
        }
      } catch (refreshError) {
        console.error('Error refreshing service data:', refreshError);
        // Don't show an error toast here since the update was successful
      }

      setPendingInstanceTypeId(null);
    } catch (error: any) {
      console.error('Error updating instance type:', error);
      toast.error('Failed to update instance type');
    } finally {
      setInstanceTypeConfirmationOpen(false);
      setInstanceTypeLoading(false);
    }
  };

  // Save port settings changes
  const savePortSettings = async () => {
    if (!portSettingsEditing) return;
    
    try {
      setPortSettingsLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { portSettings });
      setService(updatedService);
      setPortSettingsEditing(false);
      toast.success('Port settings updated');
      
      // Update the local state with the confirmed saved ports from the server
      if (updatedService.ports) {
        setPortSettings(updatedService.ports.map(port => ({
          servicePort: port.servicePort,
          containerPort: port.containerPort
        })));
      }
    } catch (error) {
      console.error('Error updating port settings:', error);
      toast.error('Failed to update port settings');
      
      // Reset port settings to the service's current ports on error
      if (service?.ports) {
        setPortSettings(service.ports.map(port => ({
          servicePort: port.servicePort,
          containerPort: port.containerPort
        })));
      }
    } finally {
      setPortSettingsLoading(false);
    }
  };

  // Add a new port mapping
  const addPortMapping = () => {
    setPortSettings([...portSettings, { servicePort: 80, containerPort: 3000 }]);
  };

  // Remove a port mapping
  const removePortMapping = (index: number) => {
    const newPortSettings = [...portSettings];
    newPortSettings.splice(index, 1);
    setPortSettings(newPortSettings);
  };

  // Save storage capacity changes
  const saveStorageCapacity = async () => {
    if (!service || storageCapacityLoading || newStorageCapacity <= storageCapacity) return;
    
    try {
      setStorageCapacityLoading(true);
      const updatedService = await updateServiceSettings(serviceId, { 
        storageCapacity: newStorageCapacity 
      });
      setService(updatedService);
      setStorageCapacity(newStorageCapacity);
      setStorageCapacityEditing(false);
      toast.success('Storage capacity updated successfully');
      
      // Fetch the latest service data
      try {
        const refreshedService = await getService(serviceId);
        setService(refreshedService);
        if (refreshedService.storageCapacity) {
          setStorageCapacity(refreshedService.storageCapacity);
          setNewStorageCapacity(refreshedService.storageCapacity);
        }
      } catch (refreshError) {
        console.error('Error refreshing service data:', refreshError);
      }
    } catch (error: any) {
      console.error('Error updating storage capacity:', error);
      toast.error('Failed to update storage capacity');
    } finally {
      setStorageCapacityConfirmationOpen(false);
      setStorageCapacityLoading(false);
    }
  };

  // Show confirmation for storage capacity change
  const confirmStorageCapacityChange = () => {
    if (newStorageCapacity > storageCapacity) {
      setStorageCapacityConfirmationOpen(true);
    }
  };

  // Select instance type (for pending selection)
  const selectInstanceType = (instanceTypeId: string) => {
    if (!instanceTypeLoading && instanceTypeId !== selectedInstanceTypeId) {
      setPendingInstanceTypeId(instanceTypeId);
    }
  };

  // Handle confirmation of instance type change
  const confirmInstanceTypeChange = () => {
    if (pendingInstanceTypeId) {
      setInstanceTypeConfirmationOpen(true);
    }
  };

  // Calculate storage cost
  const calculateStorageCost = (sizeInGB: number): number => {
    return sizeInGB * 0.05;
  };

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        icon={Settings2}
        title="Service Settings"
        description="Configure the basic settings for your service"
      />
      
      {loading ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div className="flex justify-end">
                <Skeleton className="h-9 w-24" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40 mb-2" />
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Skeleton className="h-[60px] w-full" />
                <Skeleton className="h-[60px] w-full" />
                <Skeleton className="h-[60px] w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {!loading && service && (<Card>
        <CardHeader>
          <CardTitle>Basic Settings</CardTitle>
          <CardDescription>Manage your service name and configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="service-name">Service Name</Label>
                  <div className="flex items-center gap-2">
                    <Input 
                      id="service-name" 
                      value={serviceNameState} 
                      onChange={(e) => setServiceNameState(e.target.value)} 
                      placeholder="Enter service name"
                      disabled={!serviceNameEditing}
                      className="flex-1"
                    />
                    {!serviceNameEditing ? (
                      <Button 
                        variant="outline" 
                        onClick={() => setServiceNameEditing(true)}
                      >
                        Edit
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button 
                          variant="default" 
                          onClick={saveServiceName}
                          disabled={serviceNameLoading || service?.name === serviceNameState || !serviceNameState}
                        >
                          {serviceNameLoading ? 'Saving...' : 'Save'}
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => setServiceNameEditing(false)}
                          disabled={serviceNameLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
        </CardContent>
      </Card>)}
      
      {!loading && (service?.serviceTypeId === 'web' || service?.serviceTypeId === 'private') && (<Card>
        <CardHeader>
          <CardTitle>Build & Deploy</CardTitle>
          <CardDescription>Configure build and deploy settings for your service.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-28 mt-4" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6">
                {service?.runtime === 'DOCKER' && (
                <div className="space-y-2">
                  <Label htmlFor="runtime-file-path">Dockerfile Path</Label>
                  <div className="flex items-center gap-2">
                    <Input 
                      id="runtime-file-path"
                      value={runtimeFilePath || "./Dockerfile"}
                      className="font-mono"
                      disabled={true}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This is the path to the Dockerfile used for building your service. This cannot be changed after service creation.
                  </p>
                </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="auto-deploy">Auto Deploy</Label>
                  <p className="text-sm text-muted-foreground">
                    By default, automatically deploys your service whenever you update its code or configuration. Disable to handle deploys manually.
                  </p>
                  <div className="flex items-center gap-2">
                    {!autoDeployEditing ? (
                      <>
                        <Select
                          value={service?.autoDeployEnabled ? "yes" : "no"}
                          disabled={true}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button 
                          variant="outline" 
                          onClick={() => {
                            setAutoDeployEditing(true);
                            setAutoDeployEnabledState(service?.autoDeployEnabled || false);
                          }}
                        >
                          Edit
                        </Button>
                      </>
                    ) : (
                      <div className="flex gap-2 w-full">
                        <Select
                          value={autoDeployEnabledState ? "yes" : "no"}
                          onValueChange={(value) => setAutoDeployEnabledState(value === "yes")}
                          disabled={autoDeployLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select option" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Yes</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button 
                          variant="default" 
                          onClick={saveAutoDeploy}
                          disabled={autoDeployLoading || autoDeployEnabledState === service?.autoDeployEnabled}
                        >
                          {autoDeployLoading ? 'Saving...' : 'Save'}
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => {
                            setAutoDeployEditing(false);
                            setAutoDeployEnabledState(service?.autoDeployEnabled || false);
                          }}
                          disabled={autoDeployLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>)}


      
      {!loading && (service?.serviceTypeId === 'web') && (<Card>
        <CardHeader>
          <CardTitle>Custom Domains</CardTitle>
          <CardDescription>Configure custom domains for your service</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-28 mt-4" />
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="p-4 bg-secondary/50 rounded-md">
                  <div className="text-sm">
                    Your service is always available at{' '}
                    <Badge variant="outline" className="font-mono">
                      {`${service?.subdomain}.${APP_DOMAIN}`}
                    </Badge>
                  </div>
                  <div className="text-sm mt-2">
                    You can also point custom domains you own to this service.{' '}
                    <Button
                      variant="link"
                      className="p-0 h-auto text-blue-400 hover:underline inline-flex items-center gap-1"
                      onClick={() => setDnsConfigDialogOpen(true)}>
                      See DNS configuration instructions.
                    </Button>
                  </div>
                </div>
                
                {service?.customDomain && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Custom Domain</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-md">
                        <span className="font-mono text-sm">{service?.customDomain}</span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeCustomDomain()}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                
                {customDomainVisible ? (
                  <div className="space-y-2">
                    <Label htmlFor="new-domain">New Custom Domain</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        id="new-domain" 
                        value={customDomainState} 
                        onChange={(e) => setCustomDomainState(e.target.value)} 
                        placeholder="example.com"
                        className="flex-1"
                      />
                      <Button 
                        variant="default" 
                        onClick={saveCustomDomain}
                        disabled={customDomainLoading || !customDomainState.trim()}
                      >
                        {customDomainLoading ? 'Adding...' : 'Add'}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setCustomDomainVisible(false)}
                        disabled={customDomainLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : service?.customDomain === null ? (
                  <Button 
                    variant="outline" 
                    className="flex items-center gap-1"
                    onClick={() => setCustomDomainVisible(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Add Custom Domain
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>)}
      
      {!loading && (service?.serviceTypeId === 'web' || service?.serviceTypeId === 'private') && (
      <Card>
        <CardHeader>
          <CardTitle>Port Settings</CardTitle>
          <CardDescription>Configure which ports your service exposes internally and externally.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {portSettingsEditing ? (
            <div className="space-y-4">
              {portSettings.map((port, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-1/3">
                    <Label htmlFor={`service-port-${index}`}>Service Port</Label>
                    <Input
                      id={`service-port-${index}`}
                      type="number"
                      min="1"
                      max="65535"
                      placeholder="80"
                      value={port.servicePort}
                      onChange={(e) => {
                        const newPortSettings = [...portSettings];
                        newPortSettings[index].servicePort = parseInt(e.target.value) || 80;
                        setPortSettings(newPortSettings);
                      }}
                      className="mt-1"
                      disabled={service?.serviceTypeId === 'web'}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      External port exposed to other services
                    </p>
                  </div>
                  
                  <div className="flex items-center">
                    <span className="text-muted-foreground">→</span>
                  </div>
                  
                  <div className="w-1/3">
                    <Label htmlFor={`container-port-${index}`}>Container Port</Label>
                    <Input
                      id={`container-port-${index}`}
                      type="number"
                      min="1"
                      max="65535"
                      placeholder="3000"
                      value={port.containerPort}
                      onChange={(e) => {
                        const newPortSettings = [...portSettings];
                        newPortSettings[index].containerPort = parseInt(e.target.value) || 3000;
                        setPortSettings(newPortSettings);
                      }}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Internal port where your app listens
                    </p>
                  </div>
                  
                  {/* Only show delete button for private services, and only if there's more than one port */}
                  {service?.serviceTypeId === 'private' && portSettings.length > 1 && (
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePortMapping(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Only allow adding port mappings for private services */}
              {service?.serviceTypeId === 'private' && (
                <div className="flex items-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addPortMapping}
                    className="flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" /> Add Port Mapping
                  </Button>
                </div>
              )}
              
              <div className="flex items-center gap-2 mt-6">
                <Button
                  onClick={savePortSettings}
                  disabled={portSettingsLoading}
                >
                  {portSettingsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Reset port settings to the original state from the service
                    if (service?.ports && service.ports.length > 0) {
                      setPortSettings(service.ports.map(port => ({
                        servicePort: port.servicePort,
                        containerPort: port.containerPort
                      })));
                    } else if (service?.serviceTypeId === 'web' || service?.serviceTypeId === 'private') {
                      // Default settings for web/private services
                      setPortSettings([{ servicePort: 80, containerPort: 3000 }]);
                    } else {
                      setPortSettings([]);
                    }
                    setPortSettingsEditing(false);
                  }}
                  disabled={portSettingsLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-md">
                <Label className="block mb-2">Current Port Mappings</Label>
                {portSettings.length > 0 ? (
                  <div className="space-y-2">
                    {portSettings.map((port, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Badge variant="outline" className="px-2 py-1">
                          {port.servicePort} → {port.containerPort}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No port mappings configured</p>
                )}
              </div>
              
              <Button
                variant="outline"
                onClick={() => setPortSettingsEditing(true)}
                className="flex items-center gap-1"
              >
                <Settings2 className="h-4 w-4" /> Edit Port Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      )}
      
      {!loading && (service?.serviceTypeId === 'web' || service?.serviceTypeId === 'private') && (<Card>
        <CardHeader>
          <CardTitle>Health Checks</CardTitle>
          <CardDescription>
            Provide an HTTP endpoint path that Deployra messages periodically to monitor your service.
            <br />
            Note: Health checks only works if service port 80 exists in your port settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="h-10 w-28 mt-4" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="health-check-path">Health Check Path</Label>
                  <div className="flex items-center gap-2">
                    <Input 
                      id="health-check-path" 
                      value={healthCheckPathState} 
                      onChange={(e) => setHealthCheckPathState(e.target.value)} 
                      placeholder="/"
                      disabled={!healthCheckPathEditing}
                      className="flex-1"
                    />
                    {!healthCheckPathEditing ? (
                      <Button 
                        variant="outline" 
                        onClick={() => setHealthCheckPathEditing(true)}
                      >
                        Edit
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button 
                          variant="default" 
                          onClick={saveHealthCheckPath}
                          disabled={healthCheckPathLoading || service?.healthCheckPath === healthCheckPathState || !healthCheckPathState}
                        >
                          {healthCheckPathLoading ? 'Saving...' : 'Save'}
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => setHealthCheckPathEditing(false)}
                          disabled={healthCheckPathLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>)}

      {/* Instance Type Settings Card */}
      {!loading && service && service.serviceTypeId && (
        <Card>
          <CardHeader>
            <CardTitle>Instance Type</CardTitle>
            <CardDescription>
              Configure the compute resources for your service
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading || instanceTypeGroupsLoading ? (
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
                      {group.instanceTypes.map((type: InstanceType) => (
                        <div
                          key={type.id}
                          className={cn(
                            "border rounded-lg p-4 cursor-pointer hover:border-primary transition-colors",
                            pendingInstanceTypeId === type.id 
                              ? "border-primary bg-primary/5 border-2" 
                              : selectedInstanceTypeId === type.id 
                                ? "border-primary bg-primary/5" 
                                : "border-border"
                          )}
                          onClick={() => selectInstanceType(type.id)}
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
                            {selectedInstanceTypeId === type.id && instanceTypeLoading && (
                              <div className="text-right">
                                <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="mt-4 flex justify-end items-center">
                  <Button 
                    onClick={confirmInstanceTypeChange}
                    disabled={instanceTypeLoading || !pendingInstanceTypeId}
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storage Capacity Card - For MySQL, PostgreSQL, and Web/Private services with storage */}
      {!loading && service && (service.serviceTypeId === "mysql" || service.serviceTypeId === "postgresql" || ((service.serviceTypeId === "web" || service.serviceTypeId === "private") && storageCapacity > 0)) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Storage Capacity
            </CardTitle>
            <CardDescription>
              {service.serviceTypeId === "web" || service.serviceTypeId === "private"
                ? "Configure the persistent storage capacity for your service. Storage capacity can only be increased, not decreased. Note: Scaling is disabled when storage is attached."
                : `Configure the storage capacity for your ${service.serviceTypeId === "mysql" ? "MySQL" : service.serviceTypeId === "postgresql" ? "PostgreSQL" : service.serviceTypeId === "memory" ? "Memory" : "Unknown"} service. Storage capacity can only be increased, not decreased.`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-secondary/50 rounded-md">
                <div className="text-sm">
                  Current storage capacity: <Badge variant="outline" className="font-mono">{storageCapacity} GB</Badge>
                </div>
                <div className="text-sm mt-2">
                  Current monthly cost: <span className="font-semibold">${calculateStorageCost(storageCapacity).toFixed(2)}</span>
                </div>
                <div className="text-sm mt-2">
                  You can only increase storage capacity. Decreasing is not supported.
                </div>
              </div>

              {storageCapacityEditing ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="storage-capacity">New Storage Capacity (GB)</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        id="storage-capacity" 
                        type="number"
                        min={storageCapacity}
                        step={1}
                        value={newStorageCapacity} 
                        onChange={(e) => setNewStorageCapacity(parseInt(e.target.value))} 
                        className="flex-1"
                      />
                      <div className="flex gap-2">
                        <Button 
                          variant="default" 
                          onClick={confirmStorageCapacityChange}
                          disabled={storageCapacityLoading || newStorageCapacity <= storageCapacity}
                        >
                          {storageCapacityLoading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Save
                            </>
                          ) : 'Save'}
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => {
                            setStorageCapacityEditing(false);
                            setNewStorageCapacity(storageCapacity);
                          }}
                          disabled={storageCapacityLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>

                  {newStorageCapacity > storageCapacity && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                      <p className="text-sm mb-2">
                        New monthly cost: <span className="font-semibold">${calculateStorageCost(newStorageCapacity).toFixed(2)}</span> 
                        {" "}(+${(calculateStorageCost(newStorageCapacity) - calculateStorageCost(storageCapacity)).toFixed(2)})
                      </p>
                      <p className="text-sm text-yellow-600 dark:text-yellow-400">
                        Increasing storage capacity may result in additional charges. Your service will be briefly restarted during this operation.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  className="flex items-center gap-1"
                  onClick={() => setStorageCapacityEditing(true)}
                >
                  <Plus className="h-4 w-4" />
                  Increase Storage Capacity
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && service && (<Card>
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions that affect your service</CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            variant="destructive" 
            disabled={loading}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete Service
          </Button>
          <p className="text-sm text-muted-foreground mt-2">
            This action is irreversible. Once deleted, all data associated with this service will be permanently removed.
          </p>
        </CardContent>
      </Card>)}

      {/* Delete Service Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) {
          setConfirmServiceName('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Service</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <b>{service?.name}</b> service? This action cannot be undone and all data associated with this service will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-service-name">Type <span className="font-semibold">{service?.name}</span> to confirm deletion</Label>
              <Input 
                id="confirm-service-name"
                value={confirmServiceName}
                onChange={(e) => setConfirmServiceName(e.target.value)}
                placeholder={`Type "${service?.name}" to confirm`}
                disabled={deleteLoading}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  setDeleteLoading(true);
                  await deleteService(serviceId);
                  toast.success('Service deleted successfully');
                  router.push(`/dashboard/${organizationId}/projects/${projectId}`);
                } catch (error) {
                  console.error('Error deleting service:', error);
                  toast.error('Failed to delete service');
                  setDeleteLoading(false);
                }
              }}
              disabled={deleteLoading || confirmServiceName !== service?.name}
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Delete Service
                </>
              ) : (
                'Delete Service'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Instance Type Confirmation Dialog */}
      <Dialog open={instanceTypeConfirmationOpen} onOpenChange={setInstanceTypeConfirmationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Instance Type Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to change the instance type for this service?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {pendingInstanceTypeId && (
              <>
                <div className="space-y-2">
                  <p className="font-medium">Current Instance Type:</p>
                  <div className="p-3 border rounded-md bg-muted/50">
                    <p className="font-medium">{selectedInstanceType?.name || 'None'}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedInstanceType ? `${selectedInstanceType.cpuCount} CPU, ${selectedInstanceType.memoryMB >= 1024 ? `${(selectedInstanceType.memoryMB / 1024).toFixed(1)} GB` : `${selectedInstanceType.memoryMB} MB`} RAM` : ''}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="font-medium">New Instance Type:</p>
                  {(() => {
                    let newInstanceType: InstanceType | null = null;
                    for (const group of instanceTypeGroups) {
                      const foundType = group.instanceTypes.find((type: InstanceType) => type.id === pendingInstanceTypeId);
                      if (foundType) {
                        newInstanceType = foundType;
                        break;
                      }
                    }

                    return newInstanceType ? (
                      <div className="p-3 border rounded-md bg-muted/50">
                        <p className="font-medium">{newInstanceType.name}</p>
                        <p className="text-sm text-muted-foreground">{newInstanceType.cpuCount} CPU, {newInstanceType.memoryMB >= 1024 ? `${(newInstanceType.memoryMB / 1024).toFixed(1)} GB` : `${newInstanceType.memoryMB} MB`} RAM</p>
                      </div>
                    ) : null;
                  })()}
                </div>
                
                <p className="text-sm text-muted-foreground">
                  Changing the instance type will restart your service. This may cause a brief downtime.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInstanceTypeConfirmationOpen(false);
                setPendingInstanceTypeId(null);
              }}
              disabled={instanceTypeLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingInstanceTypeId) {
                  saveInstanceType(pendingInstanceTypeId);
                }
              }}
              disabled={instanceTypeLoading || !pendingInstanceTypeId}
            >
              {instanceTypeLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Confirm Change
                </>
              ) : (
                'Confirm Change'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Storage Capacity Confirmation Dialog */}
      <Dialog open={storageCapacityConfirmationOpen} onOpenChange={setStorageCapacityConfirmationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Storage Capacity Change</DialogTitle>
            <DialogDescription>
              Are you sure you want to change the storage capacity for this service?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <p className="font-medium">Current Storage Capacity:</p>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{storageCapacity} GB</p>
                <p className="text-sm text-muted-foreground">
                  ${calculateStorageCost(storageCapacity).toFixed(2)} / month
                </p>
              </div>
            </div>
            
            <div className="space-y-2">
              <p className="font-medium">New Storage Capacity:</p>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="font-medium">{newStorageCapacity} GB</p>
                <p className="text-sm text-muted-foreground">
                  ${calculateStorageCost(newStorageCapacity).toFixed(2)} / month
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Price difference: +${(calculateStorageCost(newStorageCapacity) - calculateStorageCost(storageCapacity)).toFixed(2)} / month
                </p>
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Changing the storage capacity will restart your service. This may cause a brief downtime.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setStorageCapacityConfirmationOpen(false);
              }}
              disabled={storageCapacityLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={saveStorageCapacity}
              disabled={storageCapacityLoading}
            >
              {storageCapacityLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Confirm Change
                </>
              ) : (
                'Confirm Change'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DNS Configuration Dialog */}
      <Dialog open={dnsConfigDialogOpen} onOpenChange={setDnsConfigDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>DNS Configuration Instructions</DialogTitle>
            <DialogDescription>
              Follow these steps to point your custom domain to this service.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <p className="font-medium">Add a CNAME Record</p>
              <div className="p-3 border rounded-md bg-muted/50 space-y-3">
                <div>
                  <p className="text-sm font-medium">Host / Name</p>
                  <p className="text-sm text-muted-foreground">Use your subdomain (e.g., www) or @ for root domain</p>
                </div>
                <div>
                  <p className="text-sm font-medium">Target / Value</p>
                  <div className="flex items-center gap-2">
                    <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm">
                      {CNAME_TARGET}
                    </code>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        navigator.clipboard.writeText(CNAME_TARGET);
                        toast.success('Copied to clipboard');
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">TTL</p>
                  <p className="text-sm text-muted-foreground">3600 (1 hour) or automatic</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <p className="font-medium">DNS Provider</p>
              <div className="p-3 border rounded-md bg-muted/50">
                <p className="text-sm">Go to your DNS provider (e.g., Cloudflare, GoDaddy, Namecheap, etc.) and add the CNAME record with the values above.</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <p className="font-medium">Important Notes</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                <li>DNS changes may take up to 24-48 hours to propagate globally</li>
                <li>After adding the CNAME record, add your custom domain in the settings above</li>
                <li>SSL certificates will be automatically provisioned for your custom domain</li>
                <li>For root domains (@), some DNS providers require an A record instead of a CNAME</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setDnsConfigDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
