import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create service type tags first
  console.log('Starting to seed service type tags...');
  
  // Define the tags
  const serviceTags = [
    {
      id: 'service',
      label: 'Service',
      index: 1,
    },
    {
      id: 'database',
      label: 'Database',
      index: 2,
    },
    {
      id: 'memory',
      label: 'Memory',
      index: 3,
    },
    /*{
      id: 'data',
      label: 'Data',
      index: 4,
    },*/
  ];

  // Create tags one by one with normal Prisma API
  for (const tag of serviceTags) {
    try {
      await prisma.serviceTypeTag.upsert({
        where: { id: tag.id },
        update: {
          label: tag.label,
          index: tag.index,
        },
        create: tag,
      });
      console.log(`Service type tag ${tag.id} created or updated.`);
    } catch (error) {
      console.error(`Error creating tag ${tag.id}:`, error);
    }
  }

  // Define service types
  const serviceTypes = [
    {
      id: 'web',
      title: 'Web Service',
      description: 'Dynamic web app. Ideal for full-stack apps, API servers, and mobile backends.',
      tagId: 'service',
      index: 1,
      isVisible: true,
    },
    {
      id: 'private',
      title: 'Private Service',
      description: 'Web app hosted on a private network, accessible only from your other services.',
      tagId: 'service',
      index: 2,
      isVisible: true,
    },
    {
      id: 'mysql',
      title: 'MySQL Database',
      description: 'Relational database service running MySQL.',
      tagId: 'database',
      index: 1,
      isVisible: true,
    },
    {
      id: 'postgresql',
      title: 'PostgreSQL Database',
      description: 'Advanced open source relational database.',
      tagId: 'database',
      index: 2,
      isVisible: true,
    },
    {
      id: 'memory',
      title: 'Memory',
      description: 'In-memory data structure store for caching and real-time applications. Powered by Valkey.',
      tagId: 'memory',
      index: 1,
      isVisible: true,
    },
    /*
    {
      id: 'etcd',
      title: 'etcd',
      description: 'Distributed key-value store for configuration and service discovery.',
      tagId: 'data',
      index: 1,
      isVisible: true,
    },*/
  ];

  console.log('Starting to seed service types...');

  // Create service types using normal Prisma API
  for (const type of serviceTypes) {
    try {
      await prisma.serviceType.upsert({
        where: { id: type.id },
        update: type,
        create: type,
      });
      console.log(`Service type ${type.id} created or updated.`);
    } catch (error) {
      console.error(`Error creating service type ${type.id}:`, error);
    }
  }

  console.log('Seeding completed.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
