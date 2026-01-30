import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getTokenFromCookies } from '@/lib/server/auth'
import { logger } from '@/lib/utils/logger'

// Paths that require redirection to dashboard if authenticated
const AUTH_PATHS = ['/login']

// Routes that require authentication
const PROTECTED_ROUTES = {
  dashboard: {
    base: '/dashboard',
    pattern: /^\/dashboard(?:\/.*$)?$/  // Matches /dashboard and all its subpaths
  },
  account: {
    base: '/account',
    pattern: /^\/account(?:\/[^/]+$)?$/  // Matches /account and /account/settings
  }
}

// All routes that should be handled by middleware
const MIDDLEWARE_ROUTES = [
  '/',
  ...AUTH_PATHS,
  ...Object.values(PROTECTED_ROUTES).map(route => route.base)
]

export async function middleware(request: NextRequest) {
  // Log the incoming request
  logger.request(request)

  const { pathname, search } = request.nextUrl

  // Check if the path matches any protected route patterns
  const isProtectedRoute = Object.values(PROTECTED_ROUTES)
    .some(route => route.pattern.test(pathname))

  // Skip middleware for non-matching routes (e.g. Next.js internal, api, assets)
  if (!MIDDLEWARE_ROUTES.includes(pathname) && !isProtectedRoute) {
    return NextResponse.next()
  }

  // Get token from cookies
  const token = await getTokenFromCookies()

  // Helper to build safe callback target (only allow same-origin relative paths)
  const originalTarget = `${pathname}${search || ''}`
  const buildLoginRedirect = () => {
    const url = new URL('/login', request.url)
    if (originalTarget !== '/') {
      url.searchParams.set('callbackUrl', originalTarget)
    }
    return NextResponse.redirect(url)
  }

  // Handle root path - redirect to dashboard if authenticated, login if not
  if (pathname === '/') {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    } else {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // If no token and trying to access protected route, redirect to login with callbackUrl
  if (!token && isProtectedRoute) {
    return buildLoginRedirect()
  }

  // If has token and trying to access auth pages, redirect to callbackUrl if present or dashboard
  if (token && AUTH_PATHS.includes(pathname)) {
    const cb = request.nextUrl.searchParams.get('callbackUrl')
    // Only allow relative paths for safety
    const safeCb = cb && cb.startsWith('/') ? cb : null
    return NextResponse.redirect(new URL(safeCb || '/dashboard', request.url))
  }

  // If has token, verify it for protected routes
  if (token && isProtectedRoute) {
    try {
      // Verify token using API route
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api'
      const response = await fetch(`${apiUrl}/auth/user`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.status !== "success") {
        // Token is invalid, redirect to login with callback
        const res = buildLoginRedirect()
        res.cookies.delete('token')
        return res
      }
    } catch (error) {
      console.error('Token verification error:', error)
      // On error, remove token and redirect to login (preserve callback)
      const res = buildLoginRedirect()
      res.cookies.delete('token')
      return res
    }
  }

  return NextResponse.next()
}

// Configure middleware matcher
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}
