'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Github,
  GitBranch,
  Loader2,
  X,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import Link from 'next/link';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import {
  getDeployment,
  cancelDeployment,
  getToken
} from '@/lib/api';
import { Deployment } from '@/lib/models';
import { WebSocketClient, DeploymentLogPayload, ErrorPayload } from '@/lib/websocket';
import { calculateDuration } from '@/lib/utils';

export default function DeploymentDetailPage() {
  const params = useParams();
  const organizationId = params.organizationId as string;
  const projectId = params.projectId as string;
  const serviceId = params.serviceId as string;
  const deploymentId = params.deploymentId as string;

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocketClient | null>(null)

  const fetchDeployment = async () => {
    try {
      const data = await getDeployment(deploymentId);
      setDeployment(data);
    } catch (error) {
      console.error('Error fetching deployment:', error);
      toast.error('Failed to load deployment details');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDeployment = async () => {
    try {
      setCanceling(true);
      await cancelDeployment(deploymentId);
      toast.success('Deployment cancellation initiated');
      setTimeout(() => {
        fetchDeployment();
        setCanceling(false);
      }, 1000);
    } catch (error) {
      console.error('Error cancelling deployment:', error);
      toast.error('Failed to cancel deployment');
      setCanceling(false);
    }
  };

  // Initialize terminal when deployment is loaded and div is available
  useEffect(() => {
    if (loading || !deployment || !terminalRef.current || terminalInstance.current) return;

    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
      },
      convertEol: true,
      scrollback: 10000,
    })

    const fit = new FitAddon()
    terminal.loadAddon(fit)
    fitAddon.current = fit

    terminal.loadAddon(new WebLinksAddon())
    terminal.open(terminalRef.current)
    terminalInstance.current = terminal
    fit.fit()

    // Start WebSocket stream
    startStream(deploymentId)

    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect()
        wsRef.current = null
      }
    }
  }, [loading, deployment?.id]);

  const startStream = (deploymentId: string) => {
    if (!deploymentId || !terminalInstance.current) return;

    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }

    try {
      terminalInstance.current.clear();

      const token = getToken()
      if (!token) {
        terminalInstance.current.writeln("\x1b[31mError: Authentication token not found. Please log in again.\x1b[0m")
        return
      }

      const ws = new WebSocketClient(token)
      wsRef.current = ws

      ws.on("connect", () => {
        terminalInstance.current?.clear();
        terminalInstance.current?.writeln("\x1b[32mConnected to log stream. Fetching logs...\x1b[0m")

        ws.joinDeploymentLogs({ deploymentId })
      })

      ws.on("disconnect", () => {
        terminalInstance.current?.writeln("\x1b[31mDisconnected from log stream\x1b[0m")
      })

      ws.on("connect_error", (payload) => {
        const error = payload as ErrorPayload
        console.error("WebSocket connection error:", error)
        terminalInstance.current?.writeln(`\x1b[31mConnection error: ${error.message}\x1b[0m`)
      })

      ws.on("deployment_log", (payload) => {
        console.log("[WebSocket] Received deployment_log:", payload)
        const logData = payload as DeploymentLogPayload

        if (logData.deploymentId !== deploymentId) {
          console.log("[WebSocket] Skipping log - deploymentId mismatch:", logData.deploymentId, "!==", deploymentId)
          return
        }

        const timestamp = format(new Date(logData.timestamp || Date.now()), 'yyyy-MM-dd\'T\'HH:mm:ss')
        const logLevel = logData.type || "INFO"
        const logText = logData.text || ""

        let coloredPrefix = ""
        switch (logLevel.toUpperCase()) {
          case "ERROR":
            coloredPrefix = "\x1b[31m"
            break
          case "WARNING":
            coloredPrefix = "\x1b[33m"
            break
          case "INFO":
            coloredPrefix = "\x1b[36m"
            break
          case "STDOUT":
            coloredPrefix = "\x1b[32m"
            break
          default:
            coloredPrefix = "\x1b[32m"
        }

        terminalInstance.current?.writeln(`${coloredPrefix}[${timestamp}] [${logLevel.padEnd(7)}]\x1b[0m ${logText}`)
      })

      ws.on("error", (payload) => {
        const error = payload as ErrorPayload
        console.error("Error from WebSocket server:", error)
        terminalInstance.current?.writeln(`\x1b[31mError: ${error.message || "Unknown error"}\x1b[0m`)
      })

      ws.on("logs_complete", () => {
        terminalInstance.current?.writeln("\x1b[36m--- End of logs, waiting for new logs ---\x1b[0m")
      })

      ws.connect().catch((error) => {
        console.error("Failed to connect:", error)
        terminalInstance.current?.writeln(`\x1b[31mFailed to connect to log stream\x1b[0m`)
      })
    } catch (error) {
      console.error('Error starting log stream:', error);
    }
  };

  useEffect(() => {
    fetchDeployment();

    let interval: NodeJS.Timeout;
    if (deployment && ['PENDING', 'BUILDING', 'DEPLOYING'].includes(deployment.status)) {
      interval = setInterval(() => {
        fetchDeployment();
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [deploymentId, deployment?.status]);

  return (
    <div className="container mb-10 space-y-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Link
          href={`/dashboard/${organizationId}/projects/${projectId}/services/${serviceId}/deploys`}
          className="hover:opacity-80"
        >
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            {deployment ? `Deploy #${deployment.deploymentNumber}` : 'Deployment Details'}
          </h1>
        </div>
        <div className="flex-1"></div>
        {deployment?.status && ['PENDING', 'BUILDING', 'DEPLOYING'].includes(deployment.status) && (
          <Button
            variant="destructive"
            size="sm"
            className="gap-2"
            onClick={handleCancelDeployment}
          >
            {canceling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Cancel Deploy
          </Button>
        )}
      </div>

      {loading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>
      ) : deployment ? (
        <>
          <Card className="mb-2">
            <CardHeader>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {deployment.createdAt && (
                    <span className="text-sm">
                      <Calendar className="inline h-3.5 w-3.5 mr-1" />
                      {format(new Date(deployment.createdAt), 'MMM d, yyyy HH:mm:ss')}
                    </span>
                  )}
                  <Badge
                    variant={
                      deployment.status === 'DEPLOYED' ? "default" :
                      deployment.status === 'DEPLOYING' ? "secondary" :
                      deployment.status === 'BUILDING' ? "secondary" :
                      deployment.status === 'PENDING' ? "outline" :
                      deployment.status === 'FAILED' ? "destructive" : "outline"
                    }
                    className={deployment.status === 'FAILED' ? "text-white" : ""}
                  >
                    {deployment.status.toLowerCase()}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {deployment.commitSha ? (
                    <span className="text-sm text-muted-foreground font-mono">
                      <Github className="inline h-3.5 w-3.5 mr-1" />
                      {deployment.commitSha.substring(0, 7)}
                    </span>
                  ) : deployment.branch ? (
                    <span className="text-sm text-muted-foreground">
                      <GitBranch className="inline h-3.5 w-3.5 mr-1" />
                      {deployment.branch}
                    </span>
                  ) : null}

                  {deployment.startedAt && deployment.completedAt && (
                    <span className="text-sm text-muted-foreground ml-2">
                      <Clock className="inline h-3.5 w-3.5 mr-1" />
                      Duration: {calculateDuration(new Date(deployment.startedAt), new Date(deployment.completedAt))}
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {loading ? (
          <div className="p-4">
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-full mb-2" />
          </div>
        ) : (
          <>
            {deployment.status === 'FAILED' && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span>Check the</span>
                    <Link
                      href={`/dashboard/${organizationId}/projects/${projectId}/services/${serviceId}/logs`}
                      className="underline font-medium hover:opacity-80 whitespace-nowrap"
                    >
                      service logs
                    </Link>
                    <span>for detailed error messages.</span>
                  </div>
                  <div className="text-sm flex flex-wrap items-center">
                    <span>Please verify your&nbsp;</span>
                    <Link
                      href={`/dashboard/${organizationId}/projects/${projectId}/services/${serviceId}/settings`}
                      className="underline font-medium hover:opacity-80 whitespace-nowrap"
                    >
                      Port Mappings
                    </Link>
                    <span>&nbsp;and&nbsp;</span>
                    <Link
                      href={`/dashboard/${organizationId}/projects/${projectId}/services/${serviceId}/settings`}
                      className="underline font-medium hover:opacity-80 whitespace-nowrap"
                    >
                      Health Check Path
                    </Link>
                    <span>. Your web server must respond to health check requests on the configured endpoint.</span>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <div className="bg-black rounded-md mt-4 h-[500px] relative overflow-hidden">
              <div ref={terminalRef} className="h-full w-full" />
            </div>
          </>
        )}
        </>
      ) : (
        <Card>
          <CardContent className="py-10">
            <div className="text-center text-muted-foreground">
              <p>Deployment not found or you don&apos;t have permission to view it.</p>
              <Link href={`/dashboard/${organizationId}/projects/${projectId}/services/${serviceId}/deploys`}>
                <Button variant="link" className="mt-2">
                  Back to Deployments
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
