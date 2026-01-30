"use client";

import { useState } from 'react';
import { Activity, GitBranch, Server, Github, X, RefreshCcw, Rocket, Loader2, Code } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import {
  deployService,
  cancelDeployment,
  restartService
} from '@/lib/api';
import { Service } from '@/lib/models';
import { toast } from 'sonner';
import { ServiceBadge } from './service-badge';
import { ServiceStatusBadge } from './status-badge';

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'example.com';

interface ServiceHeaderProps {
  service: Service | null;
  loading: boolean;
  icon?: React.ReactNode; // Allow customizing the icon
  onServiceUpdate?: () => Promise<void>; // Callback to refresh service data
}

export function ServiceHeader({
  service,
  loading,
  icon = <Activity className="h-6 w-6 mr-4" />,
  onServiceUpdate
}: ServiceHeaderProps) {
  const [deploying, setDeploying] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // Handle manual deploy
  const handleDeploy = async (commitSha?: string) => {
    if (!service) return;

    try {
      setDeploying(true);
      await deployService(service.id, commitSha);
      toast.success('Deployment initiated');

      // Refresh service data if callback provided
      if (onServiceUpdate) {
        await onServiceUpdate();
      }
    } catch (error) {
      console.error('Error deploying service:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to deploy service');
    } finally {
      setDeploying(false);
    }
  };

  // Handle cancel deployment
  const handleCancelDeployment = async () => {
    if (!service || !service.lastDeployment) {
      toast.error('No active deployment found to cancel');
      return;
    }

    try {
      setCanceling(true);
      await cancelDeployment(service.lastDeployment.id);
      toast.success('Deployment cancellation requested');

      // Refresh service data if callback provided
      if (onServiceUpdate) {
        await onServiceUpdate();
      }
    } catch (error) {
      console.error('Error cancelling deployment:', error);
      toast.error('Failed to cancel deployment');
    } finally {
      setCanceling(false);
    }
  };

  // Handle service restart
  const handleRestart = async () => {
    if (!service) return;

    try {
      setRestarting(true);
      await restartService(service.id);
      toast.success('Service restart initiated');

      // Refresh service data if callback provided
      if (onServiceUpdate) {
        setTimeout(async () => {
          await onServiceUpdate();
        }, 1000);
      }
    } catch (error) {
      console.error('Error restarting service:', error);
      toast.error('Failed to restart service');
      setRestarting(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      {loading || !service ? (
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-64" />
        </div>
      ) : (
        <div className="flex items-center justify-between space-y-2">
          <div className="flex items-center space-x-2">
            {icon}
            <div>
              <div className="flex justify-between items-center mb-2">
                <h1 className="text-xl font-bold tracking-tight">{service.name}</h1>
                <div className="flex items-center space-x-2 ml-2">
                  <ServiceStatusBadge status={service.status} />
                  <ServiceBadge type={service.serviceTypeId} />
                </div>
              </div>

              <div className="flex items-center text-sm text-muted-foreground">
                {service.serviceTypeId === 'web' || service.serviceTypeId === 'private' ? (
                  service.runtime === 'DOCKER' ? (
                    <>
                      <Github className="h-3.5 w-3.5 mr-1" />
                      <span>{service.repositoryName}</span>
                      <GitBranch className="h-3.5 w-3.5 mr-1 ml-2" />
                      <span>{service.branch || 'main'}</span>
                    </>
                  ) : service.runtime === 'IMAGE' && service.containerRegistryImageUri ? (
                    <>
                      <Code className="h-3.5 w-3.5 mr-1" />
                      <span>{service.containerRegistryImageUri}</span>
                    </>
                  ) : null
                ) : null}
              </div>
              {(service.serviceTypeId === 'web' && service.subdomain) ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Server className="h-3.5 w-3.5 mr-1" />
                    <Link
                      href={`https://${service.subdomain}.${APP_DOMAIN}`}
                      target="_blank"
                      className="hover:underline text-blue-400">
                      https://{service.subdomain}.{APP_DOMAIN}
                    </Link>
                  </div>
                  {service.scaleToZeroEnabled && (
                    <div className="text-xs text-amber-600 dark:text-amber-500">
                      Free instance: Automatically sleeps after 15 minutes of inactivity
                    </div>
                  )}
                </div>
              ) : service.serviceTypeId === 'private' ? (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Server className="h-3.5 w-3.5 mr-1" />
                  <Link
                    href={`#`}
                    target="_blank"
                    className="hover:underline text-blue-400">
                    http://{service.id}-service
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {loading || !service ? (
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-64" />
        </div>
      ) : service.serviceTypeId === 'web' || service.serviceTypeId === 'private' ? (
        <div className="flex flex-col md:flex-row gap-3 items-end md:items-center">
          <div className="flex gap-2">
            {service.runtime === 'DOCKER' && (
              <>
                {(service?.lastDeployment?.status === 'PENDING' || service?.lastDeployment?.status === 'DEPLOYING' || service?.lastDeployment?.status === 'BUILDING') ? (
                  <Button
                    variant="destructive"
                    className="flex items-center gap-2"
                    disabled={restarting || deploying || canceling}
                    onClick={() => handleCancelDeployment()}
                  >
                    {canceling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Cancel Deploy
                  </Button>
                ) : (
                  <Button
                    className="flex items-center gap-2"
                    onClick={() => handleDeploy()}
                    disabled={restarting || deploying || canceling}
                  >
                    {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                    Manual Deploy
                  </Button>
                )}
              </>
            )}
            <Button
              variant={service?.status === 'STOPPED' || service?.status === 'FAILED' || service?.status === 'SUSPENDED' || service?.status === 'SLEEPING' ? "default" : "outline"}
              className="flex items-center gap-2"
              onClick={() => handleRestart()}
              disabled={service.runtime === 'DOCKER' ? restarting || deploying || canceling || service?.status === 'DEPLOYING' || service?.status === 'PENDING' || service?.status === 'STOPPED' || service?.status === 'FAILED' || service?.status === 'SUSPENDED' || service?.status === 'SLEEPING' || service?.status === 'RESTARTING' : restarting || service?.status === 'RESTARTING'}
            >
              {restarting || service?.status === 'RESTARTING' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restarting
                </>
              ) : (
                <>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Restart Service
                </>
              )}
            </Button>
          </div>
        </div>
      ) : service?.serviceTypeId === 'mysql' || service?.serviceTypeId === 'postgresql' || service?.serviceTypeId === 'memory' ? (
        <div className="flex flex-col md:flex-row gap-3 items-end md:items-center">
          <div className="flex gap-2">
            <Button
              variant={service?.status === 'STOPPED' || service?.status === 'FAILED' || service?.status === 'SUSPENDED' || service?.status === 'SLEEPING' ? "default" : "outline"}
              className="flex items-center gap-2"
              disabled={restarting || service?.status === 'RESTARTING'}
              onClick={() => handleRestart()}
            >
              {restarting || service?.status === 'RESTARTING' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Restarting
                </>
              ) : (
                <>
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Restart Service
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
