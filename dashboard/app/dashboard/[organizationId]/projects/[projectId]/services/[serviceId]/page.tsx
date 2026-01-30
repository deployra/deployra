"use client";

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Activity, Check, X, RotateCcw, Rocket, Copy, SquareStack, SquareCheckBig, HardDrive, GitBranch } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { getService, getServiceEvents, getUser } from '@/lib/api';
import {Service, ServiceEvent, User} from '@/lib/models';
import { toast } from 'sonner';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ServiceHeader } from '@/components/service/header';

const DB_PROXY_HOST = process.env.NEXT_PUBLIC_DB_PROXY_HOST || 'db.example.com';

export default function ServicePage() {
  const params = useParams();
  const serviceId = params.serviceId as string;
  const [service, setService] = useState<Service | null>(null);
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isExternalAccess, setIsExternalAccess] = useState(true);
  
  // Mock storage usage data - in a real app, this would come from the API
  const [storageUsage, setStorageUsage] = useState<{
    used: number;
    total: number;
    percentage: number;
  }>({
    used: 0,
    total: 0,
    percentage: 0
  });

  // Function to fetch and process service data
  const fetchAndProcessService = async () => {
    try {
      const serviceData = await getService(serviceId);
      setService(serviceData);
      
      // Process storage usage data
      if (serviceData.storageCapacity && (serviceData.serviceTypeId === 'mysql' || serviceData.serviceTypeId === 'memory')) {
        const total = serviceData.storageCapacity;
        const used = serviceData.storageUsage || 0;
        const percentage = Math.round((used / total) * 100);
        
        setStorageUsage({
          used,
          total,
          percentage
        });
      }
      
      return serviceData;
    } catch (error) {
      console.error('Error fetching service:', error);
      toast.error('Failed to load service details');
      return null;
    }
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        
        // Fetch all data initially
        const [serviceData, eventsData, userData] = await Promise.all([
          fetchAndProcessService(),
          getServiceEvents(serviceId),
          getUser()
        ]);
        
        // Set events and user data
        setEvents(eventsData);
        setCurrentUser(userData);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Initial data fetch
    fetchInitialData();
    
    // Set up interval to refresh only service data every 5 seconds
    const intervalId = setInterval(() => {
      fetchAndProcessService();
    }, 5000);
    
    // Clean up interval on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [serviceId]);

  return (
    <div className="container mb-10 space-y-6">
      {/* Service Header */}
      <ServiceHeader 
        service={service}
        loading={loading}
        icon={<Activity className="h-6 w-6 mr-4" />}
        onServiceUpdate={async () => {
          await fetchAndProcessService();
          await getServiceEvents(serviceId).then(eventsData => setEvents(eventsData));
        }}
      />

      {/* Database Credentials Section - Only shown for MySQL services */}
      {service?.serviceTypeId === 'mysql' && service.credentials && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Credentials</CardTitle>
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${!isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>Internal</span>
                <Switch
                  checked={isExternalAccess}
                  onCheckedChange={setIsExternalAccess}
                />
                <span className={`text-sm ${isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>External</span>
              </div>
            </div>
            <CardDescription>Connection details for your MySQL service</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex flex-col space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-1">Hostname</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service');
                          toast.success('Hostname copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Port</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1">
                        {service.credentials?.port || 3306}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.port?.toString() || '3306');
                          toast.success('Port copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Username</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {service.credentials?.username || ''}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.username || '');
                          toast.success('Username copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Password</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        ••••••••••••••••
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.password || '');
                          toast.success('Password copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Database</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {service.credentials?.database || ''}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.database || '');
                          toast.success('Database name copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-sm font-medium mb-1">Connection String</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {`mysql://${service.credentials?.username || ''}:******@${isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}:${service.credentials?.port || 3306}/${service.credentials?.database || ''}`}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          const connectionString = `mysql://${service.credentials?.username || ''}:${service.credentials?.password || ''}@${isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}:${service.credentials?.port || 3306}/${service.credentials?.database || ''}`;
                          navigator.clipboard.writeText(connectionString);
                          toast.success('Connection string copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storage Usage Section - Only shown for MySQL services */}
      {!loading && service && service.serviceTypeId === 'mysql' && (
        <Card>
          <CardHeader>
            <div className="flex items-center">
              <CardTitle>Storage Usage</CardTitle>
            </div>
            <CardDescription>
              Current storage usage for your MySQL service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">
                  {storageUsage.used} GB used of {storageUsage.total} GB
                  <Badge 
                    variant={storageUsage.percentage > 80 ? "destructive" : storageUsage.percentage > 60 ? "secondary" : "outline"}
                    className="ml-2"
                  >
                    {storageUsage.percentage}%
                  </Badge>
                </div>
                <Progress value={storageUsage.percentage} className="h-2 mt-1" />
              </div>
              
              <div className="text-sm text-muted-foreground">
                {storageUsage.percentage > 80 ? (
                  <div>
                    <span className="text-destructive">
                      Your storage is almost full. Consider increasing your storage capacity.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : storageUsage.percentage > 60 ? (
                  <div>
                    <span className="text-secondary-foreground">
                      Your storage is filling up. You may want to consider increasing your storage capacity soon.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : (
                  <div>
                    <span>
                      Your storage usage is at a healthy level.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Database Credentials Section - Only shown for PostgreSQL services */}
      {service?.serviceTypeId === 'postgresql' && service.credentials && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Credentials</CardTitle>
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${!isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>Internal</span>
                <Switch
                  checked={isExternalAccess}
                  onCheckedChange={setIsExternalAccess}
                />
                <span className={`text-sm ${isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>External</span>
              </div>
            </div>
            <CardDescription>Connection details for your PostgreSQL service</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex flex-col space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-1">Hostname</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service');
                          toast.success('Hostname copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Port</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1">
                        {service.credentials?.port || 5432}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.port?.toString() || '3306');
                          toast.success('Port copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Username</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {service.credentials?.username || ''}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.username || '');
                          toast.success('Username copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Password</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        ••••••••••••••••
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.password || '');
                          toast.success('Password copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Database</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {service.credentials?.database || ''}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.database || '');
                          toast.success('Database name copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-sm font-medium mb-1">Connection String</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {`postgresql://${service.credentials?.username || ''}:******@${isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}:${service.credentials?.port || 5432}/${service.credentials?.database || ''}`}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          const connectionString = `postgresql://${service.credentials?.username || ''}:${service.credentials?.password || ''}@${isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}:${service.credentials?.port || 5432}/${service.credentials?.database || ''}`;
                          navigator.clipboard.writeText(connectionString);
                          toast.success('Connection string copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storage Usage Section - Only shown for PostgreSQL services */}
      {!loading && service && service.serviceTypeId === 'postgresql' && (
        <Card>
          <CardHeader>
            <div className="flex items-center">
              <CardTitle>Storage Usage</CardTitle>
            </div>
            <CardDescription>
              Current storage usage for your PostgreSQL service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">
                  {storageUsage.used} GB used of {storageUsage.total} GB
                  <Badge 
                    variant={storageUsage.percentage > 80 ? "destructive" : storageUsage.percentage > 60 ? "secondary" : "outline"}
                    className="ml-2"
                  >
                    {storageUsage.percentage}%
                  </Badge>
                </div>
                <Progress value={storageUsage.percentage} className="h-2 mt-1" />
              </div>
              
              <div className="text-sm text-muted-foreground">
                {storageUsage.percentage > 80 ? (
                  <div>
                    <span className="text-destructive">
                      Your storage is almost full. Consider increasing your storage capacity.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : storageUsage.percentage > 60 ? (
                  <div>
                    <span className="text-secondary-foreground">
                      Your storage is filling up. You may want to consider increasing your storage capacity soon.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : (
                  <div>
                    <span>
                      Your storage usage is at a healthy level.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Database Credentials Section - Only shown for Memory services */}
      {service?.serviceTypeId === 'memory' && service.credentials && (
        <Card>
          <CardHeader>
          <div className="flex items-center justify-between">
              <CardTitle>Credentials</CardTitle>
              <div className="flex items-center space-x-2">
                <span className={`text-sm ${!isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>Internal</span>
                <Switch
                  checked={isExternalAccess}
                  onCheckedChange={setIsExternalAccess}
                />
                <span className={`text-sm ${isExternalAccess ? 'font-medium' : 'text-muted-foreground'}`}>External</span>
              </div>
            </div>
            <CardDescription>Connection details for your Memory service</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex flex-col space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-1">Hostname</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service'}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(isExternalAccess ? service.credentials?.host || DB_PROXY_HOST : service.id + '-service');
                          toast.success('Hostname copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Port</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1">
                        {service.credentials?.port || 3306}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.port?.toString() || '3306');
                          toast.success('Port copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Username</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        {service.credentials?.username || ''}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.username || '');
                          toast.success('Username copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Password</div>
                    <div className="flex items-center">
                      <div className="bg-secondary p-2 rounded text-sm font-mono flex-1 break-all">
                        ••••••••••••••••
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="ml-2"
                        onClick={() => {
                          navigator.clipboard.writeText(service.credentials?.password || '');
                          toast.success('Password copied to clipboard');
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Storage Usage Section - Only shown for Memory services */}
      {/*!loading && service && service.serviceTypeId === 'memory' && (
        <Card>
          <CardHeader>
            <div className="flex items-center">
              <CardTitle>Storage Usage</CardTitle>
            </div>
            <CardDescription>
              Current storage usage for your Memory service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium">
                  {storageUsage.used} GB used of {storageUsage.total} GB
                  <Badge 
                    variant={storageUsage.percentage > 80 ? "destructive" : storageUsage.percentage > 60 ? "secondary" : "outline"}
                    className="ml-2"
                  >
                    {storageUsage.percentage}%
                  </Badge>
                </div>
                <Progress value={storageUsage.percentage} className="h-2 mt-1" />
              </div>
              
              <div className="text-sm text-muted-foreground">
                {storageUsage.percentage > 80 ? (
                  <div>
                    <span className="text-destructive">
                      Your storage is almost full. Consider increasing your storage capacity.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : storageUsage.percentage > 60 ? (
                  <div>
                    <span className="text-secondary-foreground">
                      Your storage is filling up. You may want to consider increasing your storage capacity soon.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                ) : (
                  <div>
                    <span>
                      Your storage usage is at a healthy level.
                    </span>
                    {" "}
                    <Link 
                      href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/settings`}
                      className="text-blue-500 hover:underline"
                    >
                      Manage storage capacity
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )*/}

      {/* Event History */}
      {(service?.serviceTypeId == "web" || service?.serviceTypeId == "private") && (<Card>
        <CardHeader>
          <CardTitle>Event History</CardTitle>
          <CardDescription>A log of all service-related events</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {Array(5).fill(0).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-2 border-b">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-5 w-64" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No events recorded yet
            </div>
          ) : (
            <div className="flex flex-col divide-y">
              {events.map((event) => {
                // Get commit hash from deployment data if available
                const commitHash = event.deployment?.commitSha || null;
                
                // Parse date for proper formatting
                const eventDate = new Date(event.createdAt);
                
                return (
                  <div key={event.id} className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex">
                        <div className="mr-3 mt-1">
                          {event.type === 'DEPLOY_STARTED' && (
                            <div className="relative">
                              <Rocket className="h-5 w-5" />
                            </div>
                          )}
                          {event.type === 'DEPLOY_COMPLETED' && (
                              <Check className="h-5 w-5" />
                          )}
                          {(event.type === 'DEPLOY_FAILED' || event.type === 'DEPLOY_CANCELLED') && (
                            <X className="h-5 w-5 text-red-600" />
                          )}
                          {event.type === 'SERVICE_RESTART_STARTED' && (
                              <RotateCcw className="h-5 w-5" />
                          )}
                          {event.type === 'SERVICE_RESTART_COMPLETED' && (
                              <Check className="h-5 w-5" />
                          )}
                          {event.type === 'CONFIG_UPDATED' && (
                              <Check className="h-5 w-5" />
                          )}
                          {event.type === 'SERVICE_SCALING' && (
                              <SquareStack className="h-5 w-5" />
                          )}
                          {event.type === 'SERVICE_SCALED' && (
                              <SquareCheckBig className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center">
                            <span className="font-medium">
                              {event.type === 'DEPLOY_STARTED' && (
                                <>
                                  {event.deployment ? (
                                    <>
                                      <Link 
                                        href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/deploys/${event.deploymentId}`}
                                        className="text-blue-400 hover:underline"
                                      >
                                        Deploy #{event.deployment.deploymentNumber}
                                      </Link> 
                                      {" "} started
                                    </>
                                  ) : "Deploy started"}
                                </>
                              )}
                              {event.type === 'DEPLOY_COMPLETED' && (
                                <>
                                  {event.deployment ? (
                                    <>
                                      <Link 
                                        href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/deploys/${event.deploymentId}`}
                                        className="text-blue-400 hover:underline"
                                      >
                                        Deploy #{event.deployment.deploymentNumber}
                                      </Link> 
                                      {" "} succeeded
                                    </>
                                  ) : "Deploy succeeded"}
                                </>
                              )}
                              {event.type === 'DEPLOY_FAILED' && (
                                <>
                                  {event.deployment ? (
                                    <>
                                      <Link 
                                        href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/deploys/${event.deploymentId}`}
                                        className="text-blue-400 hover:underline"
                                      >
                                        Deploy #{event.deployment.deploymentNumber}
                                      </Link> 
                                      {" "} failed
                                    </>
                                  ) : "Deploy failed"}
                                </>
                              )}
                              {event.type === 'DEPLOY_CANCELLED' && (
                                <>
                                  {event.deployment ? (
                                    <>
                                      <Link 
                                        href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/deploys/${event.deploymentId}`}
                                        className="text-blue-400 hover:underline"
                                      >
                                        Deploy #{event.deployment.deploymentNumber}
                                      </Link> 
                                      {" "} canceled
                                    </>
                                  ) : "Deploy canceled"}
                                </>
                              )}
                              {event.type === 'SERVICE_RESTART_STARTED' && "Service restarting"}
                              {event.type === 'SERVICE_RESTART_COMPLETED' && "Service restarted"}
                              {event.type === 'CONFIG_UPDATED' && "Configuration updated"}
                              {event.type === 'SERVICE_SCALED' && (event.message || `Service scaled to ${event.payload?.targetReplicas}`)}
                              {event.type === 'SERVICE_SCALING' && (event.message || `Service scaling to ${event.payload?.targetReplicas}`)}
                            </span>
                            {commitHash && (
                              <span className="ml-2 text-muted-foreground">
                                <GitBranch className="inline h-3.5 w-3.5 mr-1" />
                                {commitHash.substring(0, 7)}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {(event.type === "DEPLOY_STARTED" || event.type === "DEPLOY_CANCELLED") && event.deployment && (
                              <>
                                {event.deployment.triggerType === 'manual' && 'Manually triggered'}
                                {event.deployment.triggerType === 'webhook' && 'Automatically triggered by webhook'}
                                {event.deployment.triggerType === 'scheduled' && 'Automatically triggered by schedule'}
                                {event.deployment.triggerType === 'automatic' && 'Automatically triggered'}
                                {event.deployment.triggeredBy === currentUser?.id 
                                  ? ' by you' 
                                  : event.deployment.triggerUser
                                    ? ` by ${event.deployment.triggerUser.firstName}` 
                                    : event.deployment.triggerType === 'manual' 
                                      ? ' by a team member' 
                                      : ''}
                                {event.deployment.triggerType === 'manual' && ' via Dashboard'}
                              </>
                            )}
                            {(event.type === "DEPLOY_FAILED") && event.deployment && (
                              <>
                                {event.message || 'Failed to deploy'}
                              </>
                            )}
                            {(event.type === "SERVICE_SCALING" && String(event.payload?.scalingReason || '') !== '' && String(event.payload?.scalingReason || '') !== 'UNKNOWN') && (
                              <>
                                {`${String(event.payload?.scalingReason)}`}
                              </>
                            )}
                          </div>
                           <span className="text-sm text-gray-500 mt-1">
                            {format(eventDate, 'MMMM d, yyyy')} at {format(eventDate, 'h:mm a')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>)}
    </div>
  );
}
