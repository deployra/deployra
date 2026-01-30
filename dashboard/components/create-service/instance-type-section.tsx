'use client';

import React, { useState, useEffect } from 'react';
import { Control, UseFormSetValue, UseFormWatch } from 'react-hook-form';

import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { InstanceTypeGroup, InstanceType } from '@/lib/models';
import { ApplicationFormValues } from './types';

interface InstanceTypeSectionProps {
  control: Control<ApplicationFormValues>;
  setValue: UseFormSetValue<ApplicationFormValues>;
  watch: UseFormWatch<ApplicationFormValues>;
  instanceTypeGroups: InstanceTypeGroup[];
  hasError?: boolean;
  onInstanceTypeChange?: (instanceType: InstanceType | null) => void;
}

export function InstanceTypeSection({
  control,
  setValue,
  watch,
  instanceTypeGroups,
  hasError = false,
  onInstanceTypeChange,
}: InstanceTypeSectionProps) {
  const [selectedInstanceType, setSelectedInstanceType] = useState<InstanceType | null>(null);
  const instanceTypeId = watch('instanceTypeId');

  // Update selected instance type when instanceTypeId changes
  useEffect(() => {
    if (instanceTypeId && instanceTypeGroups.length > 0) {
      for (const group of instanceTypeGroups) {
        const foundType = group.instanceTypes.find(type => type.id === instanceTypeId);
        if (foundType) {
          setSelectedInstanceType(foundType);
          onInstanceTypeChange?.(foundType);
          return;
        }
      }
    } else {
      setSelectedInstanceType(null);
      onInstanceTypeChange?.(null);
    }
  }, [instanceTypeId, instanceTypeGroups, onInstanceTypeChange]);

  const containerClass = cn(
    "border rounded-lg p-6 shadow-sm instance-type-section",
    { "border-red-500": hasError }
  );

  return (
    <div className={containerClass}>
      <h3 className="text-lg font-medium mb-4">Instance Type</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Select an instance type that best fits your performance needs
      </p>
      
      {instanceTypeGroups.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-[60px] w-full" />
          <Skeleton className="h-[60px] w-full" />
          <Skeleton className="h-[60px] w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {instanceTypeGroups.map((group) => (
            <div key={group.id} className="space-y-3">
              <h4 className="text-md font-medium">{group.name}</h4>
              {group.description && (
                <p className="text-sm text-muted-foreground">{group.description}</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.instanceTypes.map((type) => (
                  <div
                    key={type.id}
                    className={cn(
                      "border rounded-lg p-4 cursor-pointer hover:border-primary transition-colors",
                      instanceTypeId === type.id ? "border-primary bg-primary/5" : "border-border"
                    )}
                    onClick={() => setValue("instanceTypeId", type.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">{type.name}</div>
                        {type.description && (
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        )}
                        <div className="text-sm space-y-0.5">
                          <div><span className="font-medium">{type.cpuCount}</span> CPU</div>
                          <div><span className="font-medium">{type.memoryMB >= 1024 ? `${(type.memoryMB / 1024).toFixed(1)} GB` : `${type.memoryMB} MB`}</span> RAM</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <FormField
                control={control}
                name="instanceTypeId"
                render={({ field }) => (
                  <FormItem className="hidden">
                    <FormControl>
                      <Input {...field} type="hidden" />
                    </FormControl>
                    <FormMessage className="mt-4 text-center" />
                  </FormItem>
                )}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
