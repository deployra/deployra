'use client';

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboard } from "@/contexts/dashboard";
import { TemplateDeploymentDialog } from "@/components/template-deployment-dialog";

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const template = searchParams.get('template');

  const { loading, organizations, error } = useDashboard();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateSlug, setTemplateSlug] = useState<string>('');

  useEffect(() => {
    if (template) {
      setTemplateSlug(template);
      setShowTemplateDialog(true);
    } else {
      // Redirect to the first organization's dashboard only if we have valid organizations
      if (!loading && organizations && organizations.length > 0 && organizations[0]?.id && !template) {
        router.push(`/dashboard/${organizations[0].id}`);
      }
    }
  }, [loading, organizations, router, template]);
  
  if (loading) {
    return null;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>No organizations found. Please create an organization first.</p>
      </div>
    );
  }

  return (
    <>
      <TemplateDeploymentDialog
        open={showTemplateDialog}
        onOpenChange={setShowTemplateDialog}
        templateSlug={templateSlug}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}