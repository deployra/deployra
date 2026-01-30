'use client';

import React from 'react';
import { Control, UseFormWatch } from 'react-hook-form';

import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApplicationFormValues, PortSetting } from './types';

interface PortSettingsSectionProps {
  control: Control<ApplicationFormValues>;
  watch: UseFormWatch<ApplicationFormValues>;
}

export function PortSettingsSection({
  control,
  watch,
}: PortSettingsSectionProps) {
  const portSettings = watch('portSettings') || [];

  return (
    <div className="border rounded-lg p-6 shadow-sm mt-6">
      <h3 className="text-lg font-medium mb-4">Port Settings</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Configure service ports that will be exposed to your application
      </p>
      
      <div className="space-y-4">
        <div className="space-y-2">
          {portSettings.map((_, index) => (
            <div key={index} className="flex gap-2 items-center">
              <FormField
                control={control}
                name={`portSettings.${index}.servicePort`}
                render={({ field }) => (
                  <FormItem className="w-1/3 mb-0">
                    <FormLabel className={index === 0 ? "" : "sr-only"}>Service Port</FormLabel>
                    <FormControl>
                      <Input 
                        disabled={true}
                        type="number" 
                        min="1" 
                        max="65535" 
                        placeholder="80" 
                        {...field} 
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 80)}
                        value={field.value.toString()}
                      />
                    </FormControl>
                    <FormDescription className={index === 0 ? "text-xs" : "sr-only"}>
                      External port exposed to the internet
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center mx-2 text-muted-foreground">
                <span>→</span>
              </div>
              <FormField
                control={control}
                name={`portSettings.${index}.containerPort`}
                render={({ field }) => (
                  <FormItem className="w-1/3 mb-0">
                    <FormLabel className={index === 0 ? "" : "sr-only"}>App Port</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        min="1" 
                        max="65535" 
                        placeholder="3000" 
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 3000)}
                        value={field.value.toString()}
                      />
                    </FormControl>
                    <FormDescription className={index === 0 ? "text-xs" : "sr-only"}>
                      Internal port where your app listens
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
