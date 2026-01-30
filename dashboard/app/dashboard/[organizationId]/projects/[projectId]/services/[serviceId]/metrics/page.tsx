"use client";

import { useState, useEffect } from 'react';
import { BarChart } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getService, getServiceMetrics } from '@/lib/api';
import { ServiceMetricsData } from '@/lib/models';
import { useParams } from 'next/navigation';

// Helper function to format bytes to MB
function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 MB';

  // Convert to MB
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}

// Helper function to format CPU millicores to a readable format
function formatCPU(millicores: number) {
  if (millicores < 1000) {
    return `${millicores}m`;
  }
  return `${(millicores / 1000).toFixed(2)} cores`;
}

export default function ServiceMetricsPage() {
  const params = useParams();
  const serviceId = params.serviceId as string;

  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<any>(null);
  const [serviceMetrics, setServiceMetrics] = useState<ServiceMetricsData[]>([]);
  const [timeRange, setTimeRange] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Initial data fetch
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading(true);
      await fetchServiceDetails();
      await fetchMetricsData();
      setLoading(false);
      setIsInitialLoad(false);
    };

    loadInitialData();
  }, []);

  // Handle time range changes
  useEffect(() => {
    if (!isInitialLoad) {
      setLoading(true);
      fetchServiceDetails();
      fetchMetricsData().finally(() => setLoading(false));
    }
  }, [timeRange]);

  // Set up auto-refresh
  useEffect(() => {
    if (isInitialLoad) return;

    const refreshInterval = setInterval(() => {
      // Auto-refresh without showing loading state
      fetchServiceDetails();
      fetchMetricsData();
    }, 180000); // 3 minutes

    return () => clearInterval(refreshInterval);
  }, [isInitialLoad, timeRange]);

  const fetchServiceDetails = async () => {
    try {
      const response = await getService(serviceId);
      setService(response);
    } catch (error) {
      console.error('Error fetching service details:', error);
      toast.error('Failed to load service details');
    }
  };

  const fetchMetricsData = async () => {
    try {
      const response = await getServiceMetrics(serviceId, timeRange);
      setServiceMetrics(response.serviceMetrics);
    } catch (error) {
      console.error('Error fetching metrics data:', error);
      toast.error('Failed to load metrics data');
    }
  };

  // Prepare data for charts
  const prepareServiceMetricsData = () => {
    return serviceMetrics.map(metric => ({
      timestamp: format(new Date(metric.timestamp), 'HH:mm MM/dd'),
      cpuUsage: metric.avgCpuUsage,
      memoryUsage: metric.avgMemoryUsage,
      cpuUtilization: metric.cpuUtilizationPercentage || 0,
      memoryUtilization: metric.memoryUtilizationPercentage || 0,
      podCount: metric.podMetrics.length
    }));
  };

  return (
      <div className="container mb-10 space-y-6">
        <PageHeader
            icon={BarChart}
            title="Service Metrics"
            description="View performance metrics for your service"
        />

        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Select
                value={timeRange}
                onValueChange={(value) => setTimeRange(value as any)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Last Hour</SelectItem>
                <SelectItem value="day">Last 24 Hours</SelectItem>
                <SelectItem value="week">Last 7 Days</SelectItem>
                <SelectItem value="month">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>CPU Usage</CardTitle>
              <CardDescription>Average CPU usage for your service</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              {loading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
              ) : serviceMetrics.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={prepareServiceMetricsData()}>
                      <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="rgba(255, 255, 255, 0.1)"
                      />
                      <XAxis
                          dataKey="timestamp"
                          tick={{ fontSize: 12, fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          interval="preserveStartEnd"
                      />
                      <YAxis
                          tickFormatter={(value: number) => `${value}%`}
                          domain={[0, 100]}
                          tick={{ fontSize: 12, fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                      />
                      <Tooltip
                          formatter={(value: number, name: string, props: any) => {
                            const dataPoint = props.payload;
                            return [`${formatCPU(dataPoint.cpuUsage)} (${dataPoint.cpuUtilization}%)`, 'CPU Usage'];
                          }}
                          labelFormatter={(label: string) => `Time: ${label}`}
                          contentStyle={{
                            backgroundColor: "rgba(0, 0, 0, 0.8)",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px"
                          }}
                      />
                      <Legend wrapperStyle={{ color: "#888", fontSize: "12px" }} />
                      <Area
                          type="monotone"
                          dataKey="cpuUtilization"
                          name="CPU Utilization (%)"
                          stroke="#ffffff"
                          fill="#f5f5f5"
                          fillOpacity={0.2}
                          activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2, fill: "#fff" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
              ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No CPU metrics data available
                  </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Memory Usage</CardTitle>
              <CardDescription>Average memory usage for your service</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              {loading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
              ) : serviceMetrics.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={prepareServiceMetricsData()}>
                      <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="rgba(255, 255, 255, 0.1)"
                      />
                      <XAxis
                          dataKey="timestamp"
                          tick={{ fontSize: 12, fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          interval="preserveStartEnd"
                      />
                      <YAxis
                          tickFormatter={(value: number) => `${value}%`}
                          domain={[0, 100]}
                          tick={{ fontSize: 12, fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                      />
                      <Tooltip
                          formatter={(value: number, name: string, props: any) => {
                            const dataPoint = props.payload;
                            return [`${formatBytes(dataPoint.memoryUsage)} (${dataPoint.memoryUtilization}%)`, 'Memory Usage'];
                          }}
                          labelFormatter={(label: string) => `Time: ${label}`}
                          contentStyle={{
                            backgroundColor: "rgba(0, 0, 0, 0.8)",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px"
                          }}
                      />
                      <Legend wrapperStyle={{ color: "#888", fontSize: "12px" }} />
                      <Area
                          type="monotone"
                          dataKey="memoryUtilization"
                          name="Memory Utilization (%)"
                          stroke="#ffffff"
                          fill="#f5f5f5"
                          fillOpacity={0.2}
                          fontSize={12}
                          activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2, fill: "#fff" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
              ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No memory metrics data available
                  </div>
              )}
            </CardContent>
          </Card>

          {service?.serviceTypeId === "web" || service?.serviceTypeId === "private" && (<Card>
            <CardHeader>
              <CardTitle>Pod Count</CardTitle>
              <CardDescription>Number of running pods for your service</CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              {loading ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <Skeleton className="h-full w-full" />
                  </div>
              ) : serviceMetrics.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={prepareServiceMetricsData()}>
                      <CartesianGrid
                          strokeDasharray="3 3"
                          vertical={false}
                          stroke="rgba(255, 255, 255, 0.1)"
                      />
                      <XAxis
                          dataKey="timestamp"
                          tick={{ fontSize: 12, fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          interval="preserveStartEnd"
                      />
                      <YAxis
                          domain={['dataMin', 'dataMax + 1']}
                          allowDecimals={false}
                          tick={{ fill: "#888" }}
                          tickLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                          axisLine={{ stroke: "rgba(255, 255, 255, 0.1)" }}
                      />
                      <Tooltip
                          formatter={(value: number) => [`${value} pods`, 'Pod Count']}
                          labelFormatter={(label: string) => `Time: ${label}`}
                          contentStyle={{
                            backgroundColor: "rgba(0, 0, 0, 0.8)",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            borderRadius: "4px",
                            color: "#fff",
                            fontSize: "12px"
                          }}
                      />
                      <Legend wrapperStyle={{ color: "#888", fontSize: "12px" }} />
                      <Area
                          type="stepAfter"
                          dataKey="podCount"
                          name="Pod Count"
                          stroke="#ffffff"
                          fill="#f5f5f5"
                          fillOpacity={0.2}
                          activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2, fill: "#fff" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
              ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No pod count data available
                  </div>
              )}
            </CardContent>
          </Card>)}
        </div>
      </div>
  );
}
