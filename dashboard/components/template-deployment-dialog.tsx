'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getOrganizations, getProjects } from '@/lib/api';
import { Organization, Project } from '@/lib/models';
import { toast } from 'sonner';

interface TemplateDeploymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateSlug: string;
}

export function TemplateDeploymentDialog({ open, onOpenChange, templateSlug }: TemplateDeploymentDialogProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const router = useRouter();

  // Load organizations on mount
  useEffect(() => {
    if (open) {
      loadOrganizations();
    }
  }, [open]);

  // Load projects when organization is selected
  useEffect(() => {
    if (selectedOrgId) {
      loadProjects(selectedOrgId);
    } else {
      setProjects([]);
      setSelectedProjectId('');
    }
  }, [selectedOrgId]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const orgs = await getOrganizations();
      setOrganizations(orgs);
      
      // Auto-select first organization if only one exists
      if (orgs.length === 1) {
        setSelectedOrgId(orgs[0].id);
      }
    } catch (error) {
      toast.error('Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async (orgId: string) => {
    try {
      setLoadingProjects(true);
      const projectsData = await getProjects(orgId);
      setProjects(projectsData);
      
      // Auto-select first project if only one exists
      if (projectsData.length === 1) {
        setSelectedProjectId(projectsData[0].id);
      }
    } catch (error) {
      toast.error('Failed to load projects');
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleDeploy = () => {
    if (!selectedOrgId || !selectedProjectId) {
      toast.error('Please select both organization and project');
      return;
    }

    // Redirect to create-service template page with template slug
    const url = `/dashboard/${selectedOrgId}/projects/${selectedProjectId}/create-service/template?slug=${templateSlug}`;
    router.push(url);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy Template</DialogTitle>
          <DialogDescription>
            Select the organization and project where you want to deploy this template.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Organization Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Organization</label>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Project Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            {loadingProjects ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select 
                value={selectedProjectId} 
                onValueChange={setSelectedProjectId}
                disabled={!selectedOrgId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2 mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeploy}
            disabled={!selectedOrgId || !selectedProjectId}
          >
            Continue to Deploy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
