import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_USER = {
  id: 'default-admin',
  email: 'admin@deployra.local',
  password: 'admin123',
  firstName: 'Admin',
  lastName: 'User',
};

const DEFAULT_ORGANIZATION = {
  id: 'default-org',
  name: 'Default Organization',
  description: 'Default organization for self-hosted Deployra',
};

async function main() {
  try {
    console.log('Seeding default user...');

    const hashedPassword = await bcrypt.hash(DEFAULT_USER.password, 10);

    // Create or update default user
    const user = await prisma.user.upsert({
      where: { id: DEFAULT_USER.id },
      update: {
        email: DEFAULT_USER.email,
        password: hashedPassword,
        firstName: DEFAULT_USER.firstName,
        lastName: DEFAULT_USER.lastName,
      },
      create: {
        id: DEFAULT_USER.id,
        email: DEFAULT_USER.email,
        password: hashedPassword,
        firstName: DEFAULT_USER.firstName,
        lastName: DEFAULT_USER.lastName,
        emailVerified: new Date(),
      },
    });

    console.log(`Default user created: ${user.email}`);

    // Create or update default organization
    const organization = await prisma.organization.upsert({
      where: { id: DEFAULT_ORGANIZATION.id },
      update: {
        name: DEFAULT_ORGANIZATION.name,
        description: DEFAULT_ORGANIZATION.description,
      },
      create: {
        id: DEFAULT_ORGANIZATION.id,
        name: DEFAULT_ORGANIZATION.name,
        description: DEFAULT_ORGANIZATION.description,
        userId: user.id,
      },
    });

    console.log(`Default organization created: ${organization.name}`);

    console.log('\n========================================');
    console.log('Default credentials:');
    console.log(`  Email:    ${DEFAULT_USER.email}`);
    console.log(`  Password: ${DEFAULT_USER.password}`);
    console.log('========================================\n');
    console.log('IMPORTANT: Change these credentials after first login!');

  } catch (error) {
    console.error('Error seeding default user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
