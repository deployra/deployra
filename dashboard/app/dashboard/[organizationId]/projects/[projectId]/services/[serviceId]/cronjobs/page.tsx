"use client";

import { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, Edit, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useParams } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getService, getCronJobs, createCronJob, updateCronJob, deleteCronJob } from '@/lib/api';
import { CronJob, CreateCronJobInput, UpdateCronJobInput } from '@/lib/models';

interface CronJobFormData {
  name: string;
  schedule: string;
  path: string;
  headers: string;
  enabled: boolean;
}

// Helper function to validate cron expressions
function validateCronExpression(expression: string): boolean {
  // Basic regex for cron expression validation
  // This covers the standard cron format with 5 fields: minute, hour, day of month, month, day of week
  const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])-([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9]),([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])|([0-9]|1[0-9]|2[0-3])-([0-9]|1[0-9]|2[0-3])|([0-9]|1[0-9]|2[0-3]),([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|[12][0-9]|3[01])|\*\/([1-9]|[12][0-9]|3[01])|([1-9]|[12][0-9]|3[01])-([1-9]|[12][0-9]|3[01])|([1-9]|[12][0-9]|3[01]),([1-9]|[12][0-9]|3[01])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])|([1-9]|1[0-2])-([1-9]|1[0-2])|([1-9]|1[0-2]),([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6])|([0-6])-([0-6])|([0-6]),([0-6]))$/;
  
  // Special cases for common expressions
  const specialCases = [
    '@yearly', '@annually', '@monthly', '@weekly', '@daily',
    '@midnight', '@hourly', '@reboot'
  ];
  
  return cronRegex.test(expression) || specialCases.includes(expression);
}

export default function ServiceCronJobsPage() {
  const params = useParams();
  const [loading, setLoading] = useState(true);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [service, setService] = useState<any>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [currentCronJob, setCurrentCronJob] = useState<CronJob | null>(null);
  const [formData, setFormData] = useState<CronJobFormData>({
    name: '',
    schedule: '',
    path: '',
    headers: '',
    enabled: true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const serviceId = params.serviceId as string;

  // Fetch service and cronjobs data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [serviceData, cronJobsData] = await Promise.all([
          getService(serviceId),
          getCronJobs(serviceId)
        ]);

        setService(serviceData);
        setCronJobs(cronJobsData);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [serviceId]);

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    // Validate schedule if that's the field being changed
    if (name === 'schedule') {
      if (value && !validateCronExpression(value)) {
        setScheduleError('Invalid cron expression format');
      } else {
        setScheduleError(null);
      }
    }
    
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Handle switch toggle
  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, enabled: checked }));
  };

  // Reset form data
  const resetFormData = () => {
    setFormData({
      name: '',
      schedule: '',
      path: '',
      headers: '',
      enabled: true
    });
    setCurrentCronJob(null);
  };

  // Open edit dialog with cronjob data
  const handleEditClick = (cronJob: CronJob) => {
    setCurrentCronJob(cronJob);
    setFormData({
      name: cronJob.name,
      schedule: cronJob.schedule,
      path: cronJob.path,
      headers: cronJob.headers ? JSON.stringify(cronJob.headers, null, 2) : '',
      enabled: cronJob.enabled
    });
    setIsEditDialogOpen(true);
  };

  // Handle create cronjob
  const handleCreateCronJob = async () => {
    try {
      setIsSubmitting(true);
      // Validate form data
      if (!formData.name || !formData.schedule || !formData.path) {
        toast.error('Please fill in all required fields');
        setIsSubmitting(false);
        return;
      }

      // Validate cron expression
      if (!validateCronExpression(formData.schedule)) {
        setScheduleError('Invalid cron expression format');
        toast.error('Invalid cron expression format');
        setIsSubmitting(false);
        return;
      }

      // Parse headers if provided
      let headers = null;
      if (formData.headers) {
        try {
          headers = JSON.parse(formData.headers);
        } catch (error) {
          toast.error('Invalid JSON format for headers');
          setIsSubmitting(false);
          return;
        }
      }

      const input: CreateCronJobInput = {
        name: formData.name,
        schedule: formData.schedule,
        path: formData.path,
        headers,
        enabled: formData.enabled
      };

      const newCronJob = await createCronJob(
        serviceId,
        input
      );

      toast.success('CronJob created successfully');
      setCronJobs((prev) => [...prev, newCronJob]);
      setIsCreateDialogOpen(false);
      resetFormData();
    } catch (error) {
      console.error('Error creating CronJob:', error);
      toast.error('Failed to create CronJob');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle update cronjob
  const handleUpdateCronJob = async () => {
    if (!currentCronJob) return;

    try {
      setIsSubmitting(true);
      // Validate form data
      if (!formData.name || !formData.schedule || !formData.path) {
        toast.error('Please fill in all required fields');
        setIsSubmitting(false);
        return;
      }

      // Validate cron expression
      if (!validateCronExpression(formData.schedule)) {
        setScheduleError('Invalid cron expression format');
        toast.error('Invalid cron expression format');
        setIsSubmitting(false);
        return;
      }

      // Parse headers if provided
      let headers = null;
      if (formData.headers) {
        try {
          headers = JSON.parse(formData.headers);
        } catch (error) {
          toast.error('Invalid JSON format for headers');
          setIsSubmitting(false);
          return;
        }
      }

      const input: UpdateCronJobInput = {
        name: formData.name,
        schedule: formData.schedule,
        path: formData.path,
        headers,
        enabled: formData.enabled
      };

      const updatedCronJob = await updateCronJob(
        serviceId,
        currentCronJob.id,
        input
      );

      toast.success('CronJob updated successfully');
      setCronJobs((prev) => 
        prev.map((job) => job.id === currentCronJob.id ? updatedCronJob : job)
      );
      setIsEditDialogOpen(false);
      resetFormData();
    } catch (error) {
      console.error('Error updating CronJob:', error);
      toast.error('Failed to update CronJob');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle delete cronjob
  const handleDeleteCronJob = async (id: string) => {
    if (!confirm('Are you sure you want to delete this CronJob?')) return;

    try {
      setIsSubmitting(true);
      await deleteCronJob(serviceId, id);
      toast.success('CronJob deleted successfully');
      setCronJobs((prev) => prev.filter((job) => job.id !== id));
    } catch (error) {
      console.error('Error deleting CronJob:', error);
      toast.error('Failed to delete CronJob');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle toggle cronjob enabled status
  const handleToggleCronJob = async (cronJob: CronJob) => {
    try {
      setIsSubmitting(true);
      const input: UpdateCronJobInput = {
        enabled: !cronJob.enabled
      };

      const updatedCronJob = await updateCronJob(
        serviceId,
        cronJob.id,
        input
      );

      toast.success(`CronJob ${updatedCronJob.enabled ? 'enabled' : 'disabled'} successfully`);
      setCronJobs((prev) => 
        prev.map((job) => job.id === cronJob.id ? updatedCronJob : job)
      );
    } catch (error) {
      console.error('Error updating CronJob:', error);
      toast.error('Failed to update CronJob');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container mb-10 space-y-6">
        <Skeleton className="h-10 w-[250px]" />
        <Skeleton className="h-4 w-[300px]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mb-10 space-y-6">
      <div className="flex justify-between items-center">
        <PageHeader
          title="CronJobs"
          description="Manage scheduled tasks for your service"
          icon={Clock}
        />
        {cronJobs.length > 0 && (
          <Button onClick={() => {
            resetFormData();
            setIsCreateDialogOpen(true);
          }}>
            <Plus className="h-4 w-4" />
            Add CronJob
          </Button>
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New CronJob</DialogTitle>
            <DialogDescription>
              Configure a new scheduled task for your service
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="Daily Backup"
                value={formData.name}
                onChange={handleInputChange}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="schedule">
                Schedule (Cron Expression)
                <span className="text-xs text-muted-foreground ml-2">
                  e.g., "0 0 * * *" for daily at midnight
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="schedule"
                  name="schedule"
                  placeholder="0 0 * * *"
                  value={formData.schedule}
                  onChange={handleInputChange}
                  className={scheduleError ? "border-red-500 pr-10" : ""}
                />
                {scheduleError && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                )}
              </div>
              {scheduleError && (
                <p className="text-sm text-red-500">{scheduleError}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="path">Path</Label>
              <Input
                id="path"
                name="path"
                placeholder="/api/backup"
                value={formData.path}
                onChange={handleInputChange}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="headers">
                Headers (JSON)
                <span className="text-xs text-muted-foreground ml-2">Optional</span>
              </Label>
              <Textarea
                id="headers"
                name="headers"
                placeholder='{"Authorization": "Bearer token"}'
                value={formData.headers}
                onChange={handleInputChange}
                className="min-h-[100px]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={formData.enabled}
                onCheckedChange={handleSwitchChange}
              />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCronJob} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit CronJob</DialogTitle>
            <DialogDescription>
              Update the configuration for this scheduled task
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-schedule">
                Schedule (Cron Expression)
                <span className="text-xs text-muted-foreground ml-2">
                  e.g., "0 0 * * *" for daily at midnight
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="edit-schedule"
                  name="schedule"
                  value={formData.schedule}
                  onChange={handleInputChange}
                  className={scheduleError ? "border-red-500 pr-10" : ""}
                />
                {scheduleError && (
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                )}
              </div>
              {scheduleError && (
                <p className="text-sm text-red-500">{scheduleError}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-path">Path</Label>
              <Input
                id="edit-path"
                name="path"
                value={formData.path}
                onChange={handleInputChange}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-headers">
                Headers (JSON)
                <span className="text-xs text-muted-foreground ml-2">Optional</span>
              </Label>
              <Textarea
                id="edit-headers"
                name="headers"
                value={formData.headers}
                onChange={handleInputChange}
                className="min-h-[100px]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="edit-enabled"
                checked={formData.enabled}
                onCheckedChange={handleSwitchChange}
              />
              <Label htmlFor="edit-enabled">Enabled</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCronJob} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {cronJobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-6 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No CronJobs Found</h3>
            <p className="text-sm text-muted-foreground mt-2 mb-4">
              Create your first scheduled task to automate recurring operations
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add CronJob
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cronJobs.map((cronJob) => (
            <Card key={cronJob.id} className={!cronJob.enabled ? "opacity-70" : ""}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{cronJob.name}</CardTitle>
                  <div className="flex space-x-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(cronJob)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteCronJob(cronJob.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Schedule:</span>
                    <span className="font-mono">{cronJob.schedule}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Path:</span>
                    <span className="font-mono truncate max-w-[150px]" title={cronJob.path}>
                      {cronJob.path}
                    </span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <div className="flex items-center space-x-2 w-full">
                  <Switch
                    id={`toggle-${cronJob.id}`}
                    checked={cronJob.enabled}
                    onCheckedChange={() => handleToggleCronJob(cronJob)}
                    disabled={isSubmitting}
                  />
                  <Label htmlFor={`toggle-${cronJob.id}`} className="flex-grow">
                    {cronJob.enabled ? "Enabled" : "Disabled"}
                  </Label>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
