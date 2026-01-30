import type { Metadata } from 'next';

/**
 * Default metadata configuration for the deployra platform
 * This serves as the base metadata that can be extended by individual pages
 */
export const defaultMetadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://deployra.com'),
  title: {
    default: 'Modern Cloud Application Platform | Deployra',
    template: '%s'
  },
  description: 'Build, deploy, and scale applications without complexity. Automatic deployments, Kubernetes, and monitoring in one platform.',
  keywords: ['cloud platform', 'PaaS', 'kubernetes', 'CI/CD', 'docker', 'app deployment', 'autoscaling', 'web hosting', 'developer tools', 'continuous deployment', 'infrastructure automation', 'serverless hosting', 'jamstack deployment', 'docker hosting', 'microservices platform', 'continuous integration', 'devops platform', 'startup hosting', 'cheap hosting', 'free hosting', 'affordable cloud platform', 'budget deployment', 'low cost hosting', 'free tier hosting', 'cheap web hosting', 'affordable PaaS', 'budget cloud services'],
  authors: [
    { name: 'deployra Team' }
  ],
  creator: 'deployra',
  publisher: 'deployra',
  robots: {
    index: true,
    follow: true
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://deployra.com',
    siteName: 'deployra',
    title: 'Modern Cloud Application Platform | Deployra',
    description: 'Build, deploy, and scale applications without complexity. Automatic deployments, Kubernetes, and monitoring in one platform.',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'deployra'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Modern Cloud Application Platform | Deployra',
    description: 'Build, deploy, and scale applications without complexity. Automatic deployments, Kubernetes, and monitoring in one platform.',
    images: ['/twitter-image.jpg'],
    creator: '@deployra'
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-touch-icon.png'
  },
  alternates: {
    canonical: process.env.NEXT_PUBLIC_APP_URL || 'https://deployra.com'
  }
};
