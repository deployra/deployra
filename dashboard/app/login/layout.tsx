import type { Metadata } from 'next';
import { defaultMetadata } from '@/lib/metadata';

export const metadata: Metadata = {
  ...defaultMetadata,
  title: 'Login | Deployra',
  description: 'Access your deployra account to build, deploy, and scale your applications without infrastructure complexity. Manage your cloud applications with an intuitive dashboard.',
  keywords: 'login, deployra, cloud platform, PaaS, secure access, app deployment, kubernetes, serverless hosting, jamstack deployment, docker hosting, microservices platform, continuous integration, devops platform, startup hosting, cheap hosting, free hosting, affordable cloud platform',
  openGraph: {
    ...defaultMetadata.openGraph,
    title: 'Login | Deployra',
    description: 'Access your deployra account to build, deploy, and scale your applications without infrastructure complexity.',
  },
  twitter: {
    ...defaultMetadata.twitter,
    title: 'Login | Deployra',
    description: 'Access your deployra account to build, deploy, and scale your applications without infrastructure complexity.',
  },
  alternates: {
    canonical: `${process.env.NEXT_PUBLIC_APP_URL || 'https://deployra.com'}/login`
  }
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
