'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, AlertCircle, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { validateYamlTemplate, ApiError } from '@/lib/api';
import { ServiceType, InstanceTypeGroup, YamlValidationResult } from '@/lib/models';

// YAML editor imports
import MonacoEditor from '@monaco-editor/react';

// Define form schema
const formSchema = z.object({
  projectId: z.string(),
  serviceTypeId: z.string(),
  instanceTypeId: z.string(),
  yamlTemplate: z.string().min(1, 'YAML template is required'),
});

type FormValues = z.infer<typeof formSchema>;

// Define default YAML template
const defaultYamlTemplate = `services:
  - type: web
    plan: web-basic-512mb
    runtime: image
    name: n8n-service
    image:
      url: docker.io/n8nio/n8n:latest
    envVars:
      - key: N8N_ENCRYPTION_KEY
        generateValue: true
      - key: DB_TYPE
        value: postgresdb
      - key: DB_POSTGRESDB_DATABASE
        fromDatabase:
          name: n8n-db
          property: database
      - key: DB_POSTGRESDB_HOST
        fromDatabase:
          name: n8n-db
          property: host
      - key: DB_POSTGRESDB_PASSWORD
        fromDatabase:
          name: n8n-db
          property: password
      - key: DB_POSTGRESDB_USER
        fromDatabase:
          name: n8n-db
          property: user
      - key: N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS
        value: "true"
      - key: N8N_PORT
        value: "3000"
    ports:
      - containerPort: 3000
        servicePort: 80

databases:
  - name: n8n-db
    type: postgresql
    plan: postgresql-basic-1gb
    storageCapacity: 10
`;

type TemplateServiceFormProps = {
  serviceType: ServiceType;
  onSubmit: (values: any) => Promise<void>;
  loading: boolean;
  instanceTypeGroups: InstanceTypeGroup[];
  prefilledYaml?: string;
  templateTitle?: string;
};

export function TemplateServiceForm({
  serviceType,
  onSubmit,
  loading,
  instanceTypeGroups,
  prefilledYaml,
  templateTitle,
}: TemplateServiceFormProps) {
  const [validationResult, setValidationResult] = useState<YamlValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationTimeout, setValidationTimeout] = useState<NodeJS.Timeout | null>(null);
  const [editorHeight, setEditorHeight] = useState(700);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Handle resize interactions
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = editorHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [editorHeight]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      const deltaY = e.clientY - startYRef.current;
      const newHeight = Math.max(200, startHeightRef.current + deltaY);
      setEditorHeight(newHeight);
    }
  }, []);

  // Add and remove event listeners
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: '',
      serviceTypeId: serviceType.id,
      instanceTypeId: instanceTypeGroups.length > 0 && instanceTypeGroups[0].instanceTypes.length > 0 
        ? instanceTypeGroups[0].instanceTypes[0].id 
        : '',
      yamlTemplate: prefilledYaml || defaultYamlTemplate,
    },
  });

  // Validate YAML when it changes (with debounce)
  const validateYaml = async (yaml: string) => {
    if (!yaml) return;
    
    setIsValidating(true);
    try {
      const result = await validateYamlTemplate(yaml);
      console.log(result);
      setValidationResult(result);
    } catch (error) {
      if (error instanceof ApiError) {
        setValidationResult({
          valid: false,
          message: error.message,
          data: error.data as { path: (string | number)[]; message: string; }[]
        });
      }
    } finally {
      setIsValidating(false);
    }
  };

  // Set up debounced validation
  useEffect(() => {
    const yamlValue = form.watch('yamlTemplate');
    
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }
    
    const timeoutId = setTimeout(() => {
      validateYaml(yamlValue);
    }, 1000); // 1 second debounce
    
    setValidationTimeout(timeoutId);
    
    return () => {
      if (validationTimeout) {
        clearTimeout(validationTimeout);
      }
    };
  }, [form.watch('yamlTemplate')]);

  const handleSubmit = async (values: FormValues) => {
    // Pass the form values to the parent component
    await onSubmit({
      ...values,
    });
  };

  return (
    <Card className="w-full p-0">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)}>
          <CardContent className="space-y-4 pt-4">
            {/* Template Title Display */}
            {templateTitle && (
              <div className="mb-4 p-4 bg-muted/30 rounded-lg border">
                <h3 className="font-medium text-sm text-muted-foreground mb-1">Deploying Template:</h3>
                <p className="font-semibold">{templateTitle}</p>
              </div>
            )}
            <FormField
              control={form.control}
              name="yamlTemplate"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <div className={`border rounded-md overflow-hidden`} style={{ height: `${editorHeight}px` }}>
                        <MonacoEditor
                          height={`${editorHeight}px`}
                          language="yaml"
                          theme="vs-dark"
                          value={field.value}
                          onChange={(value: string | undefined) => field.onChange(value || '')}
                          options={{
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: "on",
                            formatOnPaste: true,
                            formatOnType: true,
                            mouseWheelScrollSensitivity: 1,
                            scrollbar: {
                              alwaysConsumeMouseWheel: false
                            },
                            mouseWheel: {
                              scrollByPage: true
                            }
                          }}
                          onMount={(editor, monaco) => {
                            // Allow page to scroll when editor is scrolled to top or bottom
                            editor.onDidScrollChange((e:any) => {
                              const scrollTop = e.scrollTop;
                              const scrollHeight = editor.getScrollHeight();
                              const scrollDimensions = editor.getLayoutInfo().scrollHeight;
                              
                              // If scrolled to top or bottom, allow the page to scroll
                              if ((scrollTop === 0 || scrollTop + scrollDimensions >= scrollHeight) && e.scrollTopChanged) {
                                const html = document.documentElement;
                                const wheelEvent = new WheelEvent('wheel', { deltaY: 1 });
                                html.dispatchEvent(wheelEvent);
                              }
                            });
                          }}
                        />
                      </div>
                      {/* Resize handle */}
                      <div 
                        ref={resizeRef}
                        className="absolute bottom-0 left-0 right-0 h-1 bg-muted/50 hover:bg-muted/75 cursor-ns-resize flex items-center justify-center"
                        onMouseDown={handleMouseDown}
                      >
                        <div className="w-16 h-1 bg-muted/75 rounded-full"></div>
                      </div>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Display validation errors */}
            {validationResult?.valid === false && validationResult.data && validationResult.data.length > 0 && (
              <div className="mt-4 border border-red-400 bg-red-50 text-red-900 px-4 py-3 rounded relative">
                <div className="flex items-center mb-2">
                  <AlertCircle className="h-4 w-4 mr-2" />
                  <h3 className="font-medium">Validation Error</h3>
                </div>
                <ul className="list-disc pl-6 text-sm space-y-1">
                  {validationResult.data.map((error, index) => (
                    <li key={index}>
                      <span className="font-semibold">{error.path.join('.')}</span>: {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col items-stretch p-4">
            {/* Template summary */}
            {validationResult?.valid === true && (
              <div className="border rounded-lg p-4 shadow-sm mb-6">
                <div className="text-sm text-muted-foreground">
                  <p>
                    {validationResult.serviceCount} service{validationResult.serviceCount !== 1 ? 's' : ''}
                    {validationResult.databaseCount ? `, ${validationResult.databaseCount} database${validationResult.databaseCount !== 1 ? 's' : ''}` : ''}
                    {validationResult.memoryCount ? `, ${validationResult.memoryCount} memory service${validationResult.memoryCount !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
              </div>
            )}

            <div className="flex w-full justify-end">
              <Button 
                type="submit" 
                className="ml-auto" 
                disabled={loading || isValidating || validationResult?.valid === false}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isValidating ? 'Validating...' : 'Deploy Services'}
              </Button>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
