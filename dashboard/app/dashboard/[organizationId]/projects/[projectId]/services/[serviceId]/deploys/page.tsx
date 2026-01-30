"use client";

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Rocket, Search, Check, X, Calendar, GitBranch, Clock } from 'lucide-react';
import { calculateDuration } from '@/lib/utils';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getServiceDeployments, getService } from '@/lib/api';
import { Deployment, Service } from '@/lib/models';
import { toast } from 'sonner';
import { useParams } from 'next/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { 
  Pagination, 
  PaginationContent, 
  PaginationItem, 
  PaginationLink, 
  PaginationNext, 
  PaginationPrevious 
} from '@/components/ui/pagination';
import Link from 'next/link';
import { ServiceHeader } from '@/components/service/header';

export default function DeploysPage() {
  const params = useParams();
  const serviceId = params.serviceId as string;
  const [service, setService] = useState<Service | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 20;
  
  // Filter state
  const [dateFilter, setDateFilter] = useState<Date | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Function to fetch service details
  const fetchService = async () => {
    try {
      const serviceData = await getService(serviceId);
      setService(serviceData);
    } catch (error) {
      console.error('Error fetching service:', error);
      toast.error('Failed to load service details');
    }
  };

  // Function to fetch deployments with filters
  const fetchDeployments = async () => {
    try {
      setDeploymentsLoading(true);
      const filters = {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        date: dateFilter ? dateFilter.toISOString().split('T')[0] : undefined,
        search: searchQuery || undefined,
        page: currentPage,
        limit: pageSize
      };
      
      const response = await getServiceDeployments(serviceId, filters);
      setDeployments(response.deployments);
      setTotalPages(response.pagination.totalPages);
      setCurrentPage(response.pagination.currentPage);
    } catch (error) {
      console.error('Error fetching deployments:', error);
      toast.error('Failed to load deployments');
    } finally {
      setDeploymentsLoading(false);
    }
  };

  // Function to fetch service data
  const fetchServiceData = async () => {
    try {
      const serviceData = await getService(serviceId);
      setService(serviceData);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  // Handle filters
  useEffect(() => {
    fetchDeployments();
  }, [serviceId, statusFilter, dateFilter, searchQuery, currentPage]);

  // Initial data fetch with auto-refresh every 5 seconds
  useEffect(() => {
    // Initial fetch
    setLoading(true);
    fetchServiceData();
    setLoading(false);
    
    // Set up interval to refresh data every 5 seconds
    const intervalId = setInterval(() => {
      fetchServiceData();
    }, 5000);
    
    // Clean up interval on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [serviceId]);

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="container space-y-6">
      {/* Service Header */}
      <ServiceHeader 
        service={service}
        loading={loading}
        icon={<Rocket className="h-6 w-6 mr-4" />}
        onServiceUpdate={async () => {
          await fetchService();
          await fetchDeployments();
        }}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            <div>
              <CardTitle>Deployment History</CardTitle>
              <CardDescription>A log of all service deployments</CardDescription>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex items-center space-x-2">
                <Input
                  placeholder="Search commits..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-[200px]"
                />
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => fetchDeployments()}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-1">
                    <Calendar className="h-4 w-4 mr-1" />
                    {dateFilter ? format(dateFilter, 'PPP') : 'Filter by date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent
                    mode="single"
                    selected={dateFilter}
                    onSelect={(date) => {
                      setDateFilter(date);
                      fetchDeployments();
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              
              <Select 
                value={statusFilter} 
                onValueChange={(value) => {
                  setStatusFilter(value || undefined);
                  fetchDeployments();
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="BUILDING">Building</SelectItem>
                  <SelectItem value="DEPLOYING">Deploying</SelectItem>
                  <SelectItem value="DEPLOYED">Deployed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateFilter(undefined);
                  setStatusFilter(undefined);
                  setSearchQuery('');
                  // Reset to page 1 and fetch fresh data
                  setCurrentPage(1);
                  setTimeout(() => {
                    fetchDeployments();
                  }, 0);
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {deploymentsLoading ? (
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
          ) : deployments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {service?.runtime === 'IMAGE' ? (
                <>Deployments are not supported for image-based services</>
              ) : (
                <>No deployments found matching your filters</>
              )}
            </div>
          ) : (
            <div className="flex flex-col divide-y">
              {deployments.map((deployment) => {
                const deploymentDate = new Date(deployment.createdAt);
                return (
                  <div 
                    key={deployment.id} 
                    className="py-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex">
                        <div className="mr-3 mt-1">
                          {deployment.status === 'PENDING' && (
                            <div className="relative">
                              <Clock className="h-5 w-5" />
                            </div>
                          )}
                          {deployment.status === 'BUILDING' && (
                            <div className="relative">
                              <Rocket className="h-5 w-5" />
                            </div>
                          )}
                          {deployment.status === 'DEPLOYING' && (
                            <div className="relative">
                              <Rocket className="h-5 w-5" />
                            </div>
                          )}
                          {deployment.status === 'DEPLOYED' && (
                          <Check className="h-5 w-5" />
                          )}
                          {deployment.status === 'FAILED' && (
                            <X className="h-5 w-5 text-red-600" />
                          )}
                          {deployment.status === 'CANCELLED' && (
                            <X className="h-5 w-5 text-red-600" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center">
                            <span className="font-medium">
                              <Link 
                                href={`/dashboard/${params.organizationId}/projects/${params.projectId}/services/${serviceId}/deploys/${deployment.id}`} 
                                className="text-blue-400 hover:underline"
                              >
                                Deploy #{deployment.deploymentNumber}
                              </Link>{" "}
                              <Badge
                                variant={
                                  deployment.status === 'DEPLOYED' ? "default" : 
                                  deployment.status === 'DEPLOYING' ? "secondary" :
                                  deployment.status === 'BUILDING' ? "secondary" :
                                  deployment.status === 'PENDING' ? "outline" :
                                  deployment.status === 'FAILED' ? "destructive" :
                                  deployment.status === 'CANCELLED' ? "destructive" : "outline"
                                }
                                className={deployment.status === 'FAILED' || deployment.status === 'CANCELLED' ? "text-white" : ""}
                              >
                                {deployment.status.toLowerCase()}
                              </Badge>
                            </span>
                            {deployment.commitSha && (
                              <span className="ml-2 text-muted-foreground">
                                <GitBranch className="inline h-3.5 w-3.5 mr-1" />
                                {deployment.commitSha.substring(0, 7)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center text-sm text-gray-500 mt-1">
                            <Calendar className="h-3.5 w-3.5 mr-1" />
                            {format(deploymentDate, 'MMMM d, yyyy')} at {format(deploymentDate, 'h:mm a')}
                            
                            {deployment.completedAt && (
                              <span className="ml-2 flex items-center">
                                <Clock className="inline h-3.5 w-3.5 mr-1" />
                                Duration: {calculateDuration(new Date(deployment.startedAt), new Date(deployment.completedAt))}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // Show pages around current page
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <PaginationItem key={i}>
                        <PaginationLink
                          isActive={pageNum === currentPage}
                          onClick={() => handlePageChange(pageNum)}
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
