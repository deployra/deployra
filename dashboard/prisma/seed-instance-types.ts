import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const instanceTypeGroups = [
  {
    id: 'mysql',
    name: 'MySQL',
    description: 'MySQL database instances.',
    serviceTypeId: 'mysql',
    index: 0,
    isVisible: true,
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    description: 'PostgreSQL database instances.',
    serviceTypeId: 'postgresql',
    index: 0,
    isVisible: true,
  },
  {
    id: 'private',
    name: 'Private',
    description: 'Private service instances.',
    serviceTypeId: 'private',
    index: 0,
    isVisible: true,
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'In-memory cache instances. Powered by Valkey.',
    serviceTypeId: 'memory',
    index: 0,
    isVisible: true,
  },
  {
    id: 'web',
    name: 'Web',
    description: 'Web service instances.',
    serviceTypeId: 'web',
    index: 0,
    isVisible: true,
  },
];

const instanceTypes = [
  // MySQL instance types
  {
    id: 'mysql-1gb',
    name: '1GB',
    description: null,
    instanceTypeGroupId: 'mysql',
    cpuCount: 0.5,
    memoryMB: 1024,
    index: 0,
    isVisible: true,
  },
  {
    id: 'mysql-4gb',
    name: '4GB',
    description: null,
    instanceTypeGroupId: 'mysql',
    cpuCount: 2,
    memoryMB: 4096,
    index: 1,
    isVisible: true,
  },
  // PostgreSQL instance types
  {
    id: 'postgresql-1gb',
    name: '1GB',
    description: null,
    instanceTypeGroupId: 'postgresql',
    cpuCount: 0.5,
    memoryMB: 1024,
    index: 0,
    isVisible: true,
  },
  {
    id: 'postgresql-4gb',
    name: '4GB',
    description: null,
    instanceTypeGroupId: 'postgresql',
    cpuCount: 2,
    memoryMB: 4096,
    index: 1,
    isVisible: true,
  },
  // Private instance types
  {
    id: 'private-512mb',
    name: '512MB',
    description: null,
    instanceTypeGroupId: 'private',
    cpuCount: 0.5,
    memoryMB: 512,
    index: 0,
    isVisible: true,
  },
  {
    id: 'private-2gb',
    name: '2GB',
    description: null,
    instanceTypeGroupId: 'private',
    cpuCount: 1,
    memoryMB: 2048,
    index: 1,
    isVisible: true,
  },
  {
    id: 'private-4gb',
    name: '4GB',
    description: null,
    instanceTypeGroupId: 'private',
    cpuCount: 2,
    memoryMB: 4096,
    index: 2,
    isVisible: true,
  },
  // Memory instance types (Valkey)
  {
    id: 'memory-25mb',
    name: '25MB',
    description: null,
    instanceTypeGroupId: 'memory',
    cpuCount: 0.1,
    memoryMB: 25,
    index: 0,
    isVisible: true,
  },
  {
    id: 'memory-256mb',
    name: '256MB',
    description: null,
    instanceTypeGroupId: 'memory',
    cpuCount: 0.2,
    memoryMB: 256,
    index: 1,
    isVisible: true,
  },
  {
    id: 'memory-512mb',
    name: '512MB',
    description: null,
    instanceTypeGroupId: 'memory',
    cpuCount: 0.5,
    memoryMB: 512,
    index: 2,
    isVisible: true,
  },
  {
    id: 'memory-1gb',
    name: '1GB',
    description: null,
    instanceTypeGroupId: 'memory',
    cpuCount: 1,
    memoryMB: 1024,
    index: 3,
    isVisible: true,
  },
  // Web instance types
  {
    id: 'web-512mb',
    name: '512MB',
    description: null,
    instanceTypeGroupId: 'web',
    cpuCount: 0.5,
    memoryMB: 512,
    index: 0,
    isVisible: true,
  },
  {
    id: 'web-2gb',
    name: '2GB',
    description: null,
    instanceTypeGroupId: 'web',
    cpuCount: 1,
    memoryMB: 2048,
    index: 1,
    isVisible: true,
  },
  {
    id: 'web-4gb',
    name: '4GB',
    description: null,
    instanceTypeGroupId: 'web',
    cpuCount: 2,
    memoryMB: 4096,
    index: 2,
    isVisible: true,
  },
];

async function main() {
  try {
    console.log('Seeding instance types...');

    for (const instanceTypeGroup of instanceTypeGroups) {
      const exists = await prisma.instanceTypeGroup.findUnique({
        where: { id: instanceTypeGroup.id },
      });

      if (!exists) {
        await prisma.instanceTypeGroup.create({
          data: instanceTypeGroup,
        });
      } else {
        await prisma.instanceTypeGroup.update({
          where: { id: instanceTypeGroup.id },
          data: instanceTypeGroup,
        });
      }
    }

    for (const instanceType of instanceTypes) {
      const exists = await prisma.instanceType.findUnique({
        where: { id: instanceType.id },
      });

      if (!exists) {
        await prisma.instanceType.create({
          data: instanceType,
        });
      } else {
        await prisma.instanceType.update({
          where: { id: instanceType.id },
          data: instanceType,
        });
      }
    }

    console.log('Instance types seeded successfully');
  } catch (error) {
    console.error('Error seeding instance types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
