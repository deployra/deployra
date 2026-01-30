"use client";

import { useState, useEffect } from 'react';
import { Cpu, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getService, updateServiceScaling } from '@/lib/api';
import { Service } from '@/lib/models';
import { useParams } from 'next/navigation';

export default function ServiceScalingPage() {
  const params = useParams();
  const serviceId = params.serviceId as string;

  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Scaling configuration state
  const [minReplicas, setMinReplicas] = useState(1);
  const [maxReplicas, setMaxReplicas] = useState(1);
  const [replicas, setReplicas] = useState(1);
  const [targetCPUUtilizationPercentage, setTargetCPUUtilizationPercentage] = useState<number | undefined>(undefined);
  const [autoScalingEnabled, setAutoScalingEnabled] = useState(false);
  
  // Function to fetch service details
  const fetchService = async () => {
    try {
      const serviceData = await getService(serviceId);
      setService(serviceData);
      setMinReplicas(serviceData.minReplicas);
      setMaxReplicas(serviceData.maxReplicas);
      setReplicas(serviceData.replicas || 1);
      setTargetCPUUtilizationPercentage(serviceData.targetCPUUtilizationPercentage);
      setAutoScalingEnabled(serviceData.autoScalingEnabled);
    } catch (error) {
      console.error('Error fetching service:', error);
      toast.error('Failed to load service details');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchService();
  }, [params.serviceId]);
  
  // Handle save scaling configuration
  const handleSaveScaling = async () => {
    try {
      setSaving(true);
      
      // Validation
      if (minReplicas < 1) {
        toast.error('Minimum replicas must be at least 1');
        setSaving(false);
        return;
      }
      
      if (maxReplicas < minReplicas) {
        toast.error('Maximum replicas must be greater than or equal to minimum replicas');
        setSaving(false);
        return;
      }
      
      const updatedService = await updateServiceScaling(serviceId, {
        minReplicas: Number(minReplicas),
        maxReplicas: Number(maxReplicas),
        replicas: Number(replicas),
        targetCPUUtilizationPercentage: targetCPUUtilizationPercentage ? Number(targetCPUUtilizationPercentage) : undefined,
        autoScalingEnabled
      });
      
      setService(updatedService);
      toast.success('Scaling configuration updated');
    } catch (error) {
      console.error('Error updating scaling configuration:', error);
      toast.error('Failed to update scaling configuration');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        icon={Cpu}
        title="Service Scaling"
        description="Configure scaling settings for your service"
      />
      
      <Alert variant="default" className="mb-4 bg-slate-900 text-white border-slate-800">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Scaling Information</AlertTitle>
        <AlertDescription>
          <p>When scaling is active or replica count is greater than 1, additional resources will be allocated based on the instance type.</p>
        </AlertDescription>
      </Alert>
      
      <Card>
        <CardHeader>
          <CardTitle>Scaling Configuration</CardTitle>
          <CardDescription>Manage how your service scales based on traffic and load</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-6">
              <div className="flex items-center space-x-2">
                <Skeleton className="h-5 w-5" />
                <Skeleton className="h-5 w-32" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
                
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
              
              <Skeleton className="h-10 w-32 mt-4" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="replicas">Replicas</Label>
                  <Input 
                    className="w-[200px]"
                    id="replicas" 
                    type="number" 
                    min="1"
                    value={replicas} 
                    disabled={autoScalingEnabled}
                    onChange={(e) => setReplicas(parseInt(e.target.value) || 1)}
                  />
                  <p className="text-sm text-muted-foreground">
                    The fixed number of instances when auto-scaling is disabled
                  </p>
                </div>
              </div>
              
              <div className="border-t pt-6 mt-6">
                <div className="flex items-center space-x-2 mb-6">
                  <Switch 
                    id="autoscaling" 
                    checked={autoScalingEnabled} 
                    onCheckedChange={setAutoScalingEnabled}
                  />
                  <Label htmlFor="autoscaling">Enable Auto Scaling</Label>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="min-replicas">Minimum Replicas</Label>
                    <Input 
                      id="min-replicas" 
                      type="number" 
                      min="1"
                      value={minReplicas} 
                      disabled={!autoScalingEnabled}
                      onChange={(e) => setMinReplicas(parseInt(e.target.value) || 1)}
                    />
                    <p className="text-sm text-muted-foreground">
                      The minimum number of running instances during low demand
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="max-replicas">Maximum Replicas</Label>
                    <Input 
                      id="max-replicas" 
                      type="number" 
                      min={minReplicas}
                      value={maxReplicas} 
                      disabled={!autoScalingEnabled}
                      onChange={(e) => setMaxReplicas(parseInt(e.target.value) || minReplicas)}
                    />
                    <p className="text-sm text-muted-foreground">
                      The maximum number of instances during high demand periods
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target-cpu">Target CPU Utilization (%)</Label>
                    <Input 
                      id="target-cpu" 
                      type="number" 
                      min="1"
                      max="100"
                      value={targetCPUUtilizationPercentage || '80'} 
                      disabled={!autoScalingEnabled}
                      onChange={(e) => setTargetCPUUtilizationPercentage(e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                    <p className="text-sm text-muted-foreground">
                      CPU threshold percentage that triggers scaling operations
                    </p>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={handleSaveScaling} 
                disabled={saving || (
                  minReplicas === service?.minReplicas && 
                  maxReplicas === service?.maxReplicas && 
                  replicas === service?.replicas &&
                  targetCPUUtilizationPercentage === service?.targetCPUUtilizationPercentage &&
                  autoScalingEnabled === service?.autoScalingEnabled
                )}
                className="mt-4"
              >
                {saving ? <div className="mr-2 w-4"><Skeleton className="h-4 w-4" /></div> : null}
                Save Scaling Configuration
              </Button>
            </>
          )}
        </CardContent>
        <CardFooter className="flex items-start gap-2 text-sm border-t">
          <div>
            <p className="mt-6">
              Auto-scaling automatically adjusts the number of running instances based on CPU and memory usage.
              When disabled, the service will run with the specified minimum replicas.
            </p>
            <p className="mt-2">
              Changes to scaling settings may take a few minutes to fully propagate.
            </p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
