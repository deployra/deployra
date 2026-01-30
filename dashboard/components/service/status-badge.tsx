import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ServiceStatusBadgeProps {
  status: string;
  className?: string;
}

export function ServiceStatusBadge({ status, className }: ServiceStatusBadgeProps) {
  // Determine the appropriate variant based on status
  const variant = getStatusVariant(status);
  const textColor = status === 'FAILED' ? 'text-white' : undefined;
  
  return (
    <Badge 
      variant={variant} 
      className={cn(textColor, className)}
    >
      {status.toUpperCase()}
    </Badge>
  );
}

// Helper function to determine the badge variant based on status
function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case 'RUNNING':
      return 'default';
    case 'DEPLOYING':
    case 'PENDING':
    case 'RESTARTING':
    case 'BUILDING':
      return 'secondary';
    case 'STOPPED':
    case 'SUSPENDED':
    case 'SLEEPING':
      return 'outline';
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}