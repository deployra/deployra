import React from 'react';
import { Globe, Lock, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceIconProps {
  type: string;
  className?: string;
}

export function ServiceIcon({ type, className }: ServiceIconProps) {
  let Icon;
  
  switch (type) {
    case 'web':
      Icon = Globe;
      break;
    case 'private':
      Icon = Lock;
      break;
    case 'mysql':
      Icon = Database;
      break;
    default:
      Icon = Globe;
  }

  return <Icon className={cn(className)} />;
}
