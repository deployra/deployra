import { z } from 'zod';

// Application service form schema (for web and private services)
export const applicationServiceFormSchema = z.object({
  name: z.string().min(1, { message: "Service name is required" }),
  projectId: z.string(),
  serviceTypeId: z.string(),
  gitProviderId: z.string().optional(),
  repositoryName: z.string().optional(),
  branch: z.string().optional(),
  runtimeFilePath: z.string().optional(),
  dockerImageUrl: z.string().optional(),
  dockerUsername: z.string().optional(),
  dockerPassword: z.string().optional(),
  environmentVariables: z.array(
    z.object({
      key: z.string()
        .min(1, { message: "Key is required" })
        .regex(/^[-._a-zA-Z0-9]+$/, {
          message: "Key must only contain letters, numbers, hyphens, underscores, and periods"
        }),
      value: z.string()
    })
  ).default([]),
  portSettings: z.array(
    z.object({
      servicePort: z.number().int().min(1).max(65535),
      containerPort: z.number().int().min(1).max(65535)
    })
  ).default([{ servicePort: 80, containerPort: 3000 }]),
  instanceTypeId: z.string().min(1, { message: "Please select an instance type" }),
  sourceCode: z.boolean().default(false),
  storageEnabled: z.boolean().default(false),
  storageCapacity: z
    .number()
    .min(10)
    .refine(
      (val) => val % 5 === 0,
      { message: "Storage must be a multiple of 5 GB" }
    )
    .optional(),
});

// Form types
export type ApplicationFormValues = z.infer<typeof applicationServiceFormSchema>;

// Environment variable type
export interface EnvironmentVariable {
  key: string;
  value: string;
}

// Port setting type  
export interface PortSetting {
  servicePort: number;
  containerPort: number;
}


