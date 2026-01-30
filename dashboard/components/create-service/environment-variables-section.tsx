'use client';

import React from 'react';
import { Control, UseFormGetValues, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { PlusCircle, X } from 'lucide-react';

import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ApplicationFormValues, EnvironmentVariable } from './types';

interface EnvironmentVariablesSectionProps {
  control: Control<ApplicationFormValues>;
  getValues: UseFormGetValues<ApplicationFormValues>;
  setValue: UseFormSetValue<ApplicationFormValues>;
  watch: UseFormWatch<ApplicationFormValues>;
}

export function EnvironmentVariablesSection({
  control,
  getValues,
  setValue,
  watch,
}: EnvironmentVariablesSectionProps) {
  const environmentVariables = watch('environmentVariables') || [];

  const addEnvironmentVariable = () => {
    const currentEnvVars = getValues().environmentVariables || [];
    setValue('environmentVariables', [
      ...currentEnvVars,
      { key: '', value: '' }
    ]);
  };

  const removeEnvironmentVariable = (index: number) => {
    const currentEnvVars = getValues().environmentVariables || [];
    setValue('environmentVariables', 
      currentEnvVars.filter((_, i) => i !== index)
    );
  };

  return (
    <div className="border rounded-lg p-6 shadow-sm">
      <h3 className="text-lg font-medium mb-4">Environment Variables</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Add environment variables that will be available to your service at runtime
      </p>
      
      <div className="space-y-4">
        {environmentVariables.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-md">
            No environment variables set. Click &quot;Add Variable&quot; to add one.
          </div>
        ) : (
          <div className="space-y-4">
            {environmentVariables.map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex gap-2 items-start">
                  <FormField
                    control={control}
                    name={`environmentVariables.${index}.key`}
                    render={({ field, fieldState }) => (
                      <FormItem className="w-1/3 mb-0">
                        <FormControl>
                          <Input
                            placeholder="KEY"
                            {...field}
                            className={fieldState.error ? 'border-red-500' : ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`environmentVariables.${index}.value`}
                    render={({ field }) => (
                      <FormItem className="flex-1 mb-0">
                        <FormControl>
                          <Textarea
                            placeholder="VALUE"
                            {...field}
                            className="min-h-[40px]"
                            rows={
                              (field.value || '').split('\n').length > 1
                                ? Math.min((field.value || '').split('\n').length, 5)
                                : 1
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => removeEnvironmentVariable(index)}
                    className="shrink-0 h-10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        
        <Button
          type="button"
          variant="outline"
          onClick={addEnvironmentVariable}
          className="flex items-center gap-1"
        >
          <PlusCircle className="h-4 w-4" /> Add Variable
        </Button>
        
        <div className="mt-4 text-sm text-muted-foreground">
          <p className="font-medium">Important notes:</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            <li>Environment variables are encrypted at rest and exposed only to your service.</li>
            <li>Keys must only contain letters, numbers, hyphens, underscores, and periods.</li>
            <li>Values for keys containing &quot;password&quot;, &quot;secret&quot;, or &quot;token&quot; will be masked.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
