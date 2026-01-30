import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ServiceIcon } from './service-icon';

interface ServiceBadgeProps {
  type: string;
  className?: string;
}

export function ServiceBadge({ type, className }: ServiceBadgeProps) {
  return <Badge variant="default" className={cn(className)}>
    <ServiceIcon type={type} className="h-3 w-3 mr-1" />
    {type.toUpperCase()}
  </Badge>;
}
