'use client';

import React from 'react';
import { Control, UseFormWatch } from 'react-hook-form';
import { AlertTriangle } from 'lucide-react';

import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

import { ApplicationFormValues } from './types';

interface StorageSectionProps {
  control: Control<ApplicationFormValues>;
  watch: UseFormWatch<ApplicationFormValues>;
}

export function StorageSection({
  control,
  watch,
}: StorageSectionProps) {
  const storageEnabled = watch('storageEnabled');

  return (
    <div className="border rounded-lg p-6 shadow-sm">
      <h3 className="text-lg font-medium mb-4">Persistent Storage</h3>
      <FormField
        control={control}
        name="storageEnabled"
        render={({ field }) => (
          <FormItem className="flex flex-row items-start space-x-3 space-y-0 p-4 border rounded-lg">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel>Enable Persistent Storage</FormLabel>
              <p className="text-sm text-muted-foreground">
                When enabled, data will be persisted to disk at /data directory
              </p>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      {storageEnabled && (
        <>
          <div className="p-3 rounded-md bg-amber-50 border-amber-200 border text-amber-800 text-sm mt-4">
            <div className="flex items-start">
              <AlertTriangle className="h-4 w-4 mr-2 mt-0.5" />
              <div>
                <p className="font-medium">Scaling will be disabled</p>
                <p className="mt-1">When persistent storage is enabled, auto-scaling and manual scaling will be disabled. Your service will run with a single instance.</p>
              </div>
            </div>
          </div>
          <FormField
            control={control}
            name="storageCapacity"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel>Size</FormLabel>
                <div className="space-y-2">
                  <FormControl>
                    <div className="relative flex-1 min-w-0">
                      <Input
                        type="number"
                        min={10}
                        step={5}
                        placeholder="Storage capacity in GB"
                        value={field.value || 10}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);
                          if (!isNaN(value) && value >= 10) {
                            field.onChange(value);
                          }
                        }}
                        onBlur={field.onBlur}
                        name={field.name}
                        className="pr-10"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-sm font-medium text-muted-foreground">
                        GB
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                  <p className="text-sm text-muted-foreground">
                    Storage capacity in GB. You can increase storage at any time, but you can&apos;t decrease it.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Specify 10 GB or any multiple of 5 GB.
                  </p>
                </div>
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}
