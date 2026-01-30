"use client";

import { useState, useEffect } from 'react';
import { Settings2, Loader2, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  getProject, 
  updateProject, 
  deleteProject,
} from '@/lib/api';
import { Project } from '@/lib/models';
import { useParams } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const organizationId = params.organizationId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmProjectName, setConfirmProjectName] = useState('');

  // Basic settings
  const [projectNameState, setProjectNameState] = useState('');
  const [projectNameLoading, setProjectNameLoading] = useState(false);
  const [projectNameEditing, setProjectNameEditing] = useState(false);

  // Project description state
  const [projectDescriptionState, setProjectDescriptionState] = useState('');
  const [projectDescriptionLoading, setProjectDescriptionLoading] = useState(false);
  const [projectDescriptionEditing, setProjectDescriptionEditing] = useState(false);

  // Webhook state
  const [webhookUrlState, setWebhookUrlState] = useState('');
  const [webhookUrlLoading, setWebhookUrlLoading] = useState(false);
  const [webhookUrlEditing, setWebhookUrlEditing] = useState(false);

  // Load project data
  useEffect(() => {
    const loadProject = async () => {
      try {
        const projectData = await getProject(projectId);
        setProject(projectData);
        setProjectNameState(projectData.name);
        setProjectDescriptionState(projectData.description || '');
        setWebhookUrlState(projectData.webhookUrl || '');
      } catch (error) {
        console.error('Error loading project:', error);
        toast.error('Failed to load project');
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

  // Handle project name update
  const handleProjectNameUpdate = async () => {
    if (!project || projectNameState === project.name) {
      setProjectNameEditing(false);
      return;
    }

    try {
      setProjectNameLoading(true);
      const updatedProject = await updateProject(projectId, {
        name: projectNameState,
      });
      setProject(updatedProject);
      setProjectNameEditing(false);
      toast.success('Project name updated successfully');
    } catch (error) {
      console.error('Error updating project name:', error);
      toast.error('Failed to update project name');
      setProjectNameState(project.name); // Reset to original value
    } finally {
      setProjectNameLoading(false);
    }
  };

  // Handle project description update
  const handleProjectDescriptionUpdate = async () => {
    if (!project || projectDescriptionState === (project.description || '')) {
      setProjectDescriptionEditing(false);
      return;
    }

    try {
      setProjectDescriptionLoading(true);
      const updatedProject = await updateProject(projectId, {
        description: projectDescriptionState === '' ? null : projectDescriptionState,
      });
      setProject(updatedProject);
      setProjectDescriptionEditing(false);
      toast.success('Project description updated successfully');
    } catch (error) {
      console.error('Error updating project description:', error);
      toast.error('Failed to update project description');
      setProjectDescriptionState(project.description || ''); // Reset to original value
    } finally {
      setProjectDescriptionLoading(false);
    }
  };

  // Handle webhook update
  const handleWebhookUpdate = async () => {
    if (!project || webhookUrlState === (project.webhookUrl || '')) {
      setWebhookUrlEditing(false);
      return;
    }

    try {
      setWebhookUrlLoading(true);
      const updatedProject = await updateProject(projectId, {
        webhookUrl: webhookUrlState || null,
      });
      setProject(updatedProject);
      setWebhookUrlEditing(false);
      toast.success('Webhook updated successfully');
    } catch (error) {
      console.error('Error updating webhook:', error);
      toast.error('Failed to update webhook');
      setWebhookUrlState(project.webhookUrl || ''); // Reset to original value
    } finally {
      setWebhookUrlLoading(false);
    }
  };

  // Handle project deletion
  const handleDeleteProject = async () => {
    if (!project || confirmProjectName !== project.name) {
      return;
    }

    try {
      setDeleteLoading(true);
      await deleteProject(projectId);
      toast.success('Project deleted successfully');
      router.push(`/dashboard/${organizationId}`);
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Failed to delete project');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mb-10 space-y-6">
        <PageHeader
          icon={Settings2}
          title="Project Settings"
          description="Manage your project configuration"
        />
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-24" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mb-10 space-y-6">
        <PageHeader
          icon={Settings2}
          title="Project Settings"
          description="Manage your project configuration"
        />
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Project not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mb-10 space-y-6">
      <PageHeader
        icon={Settings2}
        title="Project Settings"
        description="Manage your project configuration"
      />

      <div className="space-y-6">
        {/* Basic Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Settings</CardTitle>
            <CardDescription>
              Update your project's basic information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <div className="flex gap-2">
                <Input
                  id="project-name"
                  value={projectNameState}
                  onChange={(e) => setProjectNameState(e.target.value)}
                  disabled={!projectNameEditing || projectNameLoading}
                  placeholder="Enter project name"
                />
                {projectNameEditing ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleProjectNameUpdate}
                      disabled={projectNameLoading || projectNameState === project.name}
                      size="sm"
                    >
                      {projectNameLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setProjectNameEditing(false);
                        setProjectNameState(project.name);
                      }}
                      disabled={projectNameLoading}
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setProjectNameEditing(true)}
                    size="sm"
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="project-description">Project Description</Label>
              <div className="flex gap-2">
                <Textarea
                  id="project-description"
                  value={projectDescriptionState}
                  onChange={(e) => setProjectDescriptionState(e.target.value)}
                  disabled={!projectDescriptionEditing || projectDescriptionLoading}
                  placeholder="Optional description for your project"
                  className="resize-none" 
                />
                {projectDescriptionEditing ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleProjectDescriptionUpdate}
                      disabled={projectDescriptionLoading || projectDescriptionState === (project.description || '')}
                      size="sm"
                    >
                      {projectDescriptionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setProjectDescriptionEditing(false);
                        setProjectDescriptionState(project.description || '');
                      }}
                      disabled={projectDescriptionLoading}
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setProjectDescriptionEditing(true)}
                    size="sm"
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Webhook */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              Webhook
            </CardTitle>
            <CardDescription>
              Configure a webhook URL to receive deployment notifications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deployment-webhook">Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  id="deployment-webhook"
                  value={webhookUrlState}
                  onChange={(e) => setWebhookUrlState(e.target.value)}
                  disabled={!webhookUrlEditing || webhookUrlLoading}
                  placeholder="https://your-webhook-url.com/webhook"
                  type="url"
                />
                {webhookUrlEditing ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleWebhookUpdate}
                      disabled={webhookUrlLoading || webhookUrlState === (project.webhookUrl || '')}
                      size="sm"
                    >
                      {webhookUrlLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setWebhookUrlEditing(false);
                        setWebhookUrlState(project.webhookUrl || '');
                      }}
                      disabled={webhookUrlLoading}
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setWebhookUrlEditing(true)}
                    size="sm"
                  >
                    Edit
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                This webhook will be called whenever a service in this project is deployed
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible and destructive actions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete Project
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              This action is irreversible. Once deleted, all services and data associated with this project will be permanently removed.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) {
          setConfirmProjectName('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <b>{project?.name}</b> project? This action cannot be undone and all services and data associated with this project will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="confirm-project-name">Type <span className="font-semibold">{project?.name}</span> to confirm deletion</Label>
              <Input 
                id="confirm-project-name"
                value={confirmProjectName}
                onChange={(e) => setConfirmProjectName(e.target.value)}
                placeholder={`Type "${project?.name}" to confirm`}
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
              onClick={handleDeleteProject}
              disabled={deleteLoading || confirmProjectName !== project?.name}
            >
              {deleteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
