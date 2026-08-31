/**
 * MACAL EMPIRE — Next.js Middleware
 * Server-side route protection, rate limiting, and content access control.
 * Runs before every request to enforce security policies.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// ─── Route Protection Configuration ────────────────────────────

const PROTECTED_ROUTES = [
  '/assessment',
  '/results',
  '/dashboard',
];

const AUTH_ONLY_ROUTES = [
  '/dashboard',
];

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/terms',
  '/privacy',
  '/ip-ownership',
  '/welcome',
  '/api/auth',
  '/api/security/log',
  '/api/ownership',
];

// Simple in-memory rate limiting for page requests
const pageRequestCounts = new Map<string, { count: number; resetTime: number }>();

function checkPageRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = `page:${ip}`;
  const entry = pageRequestCounts.get(key);

  if (!entry || now > entry.resetTime) {
    pageRequestCounts.set(key, { count: 1, resetTime: now + 60_000 });
    return true;
  }

  entry.count++;

  // Allow max 500 page requests per minute per IP (generous — Cloudflare handles real DDoS)
  if (entry.count > 500) {
    return false;
  }

  return true;
}

// Cleanup stale entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pageRequestCounts.entries()) {
      if (now > entry.resetTime) {
        pageRequestCounts.delete(key);
      }
    }
  }, 5 * 60_000);
}

function isProtected(pathname: string): boolean {
  return PROTECTED_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ─── Skip Static Assets & Internal Routes ──────────────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/logo') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.mp3') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  ) {
    return NextResponse.next();
  }

  // ─── Rate Limiting for Page Requests ───────────────────────
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const clientIp = realIp || (forwarded ? forwarded.split(',')[0].trim() : 'unknown');

  if (!checkPageRateLimit(clientIp)) {
    // Return a simple "slow down" response for excessive page requests
    return new NextResponse(
      `<!DOCTYPE html><html><head><title>Empire - Slow Down</title>
      <style>body{background:#0a0a0a;color:#8b7355;font-family:serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}
      h1{color:#c9a84c;font-size:1.5rem;margin-bottom:0.5rem}p{font-size:0.9rem}</style></head>
      <body><div><h1>The Empire Requires Patience</h1><p>Too many requests. Please wait a moment before continuing.</p></div></body></html>`,
      {
        status: 429,
        headers: { 'Content-Type': 'text/html', 'Retry-After': '30' },
      }
    );
  }

  // ─── Auth Gate for Protected Routes ────────────────────────
  //
  // PROTECTED_ROUTES was declared at the top of this file and then never
  // referenced — the gate was intended and never wired up. The practical effect:
  // only the assessment HUB checked auth, and it did so client-side, so
  // /assessment/reading, /writing, /listening, /speaking, /vocabulary and
  // /grammar each rendered a complete test to a logged-out visitor and showed
  // them a score. That score was then silently discarded, because every submit
  // path needs a session to persist anything.
  //
  // Showing someone a score we are throwing away is worse than asking them to
  // sign in first, so the declared intent is now enforced.
  if (isProtected(pathname)) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const login = new URL('/login', request.url);
      // Preserve the destination so login can return them to it.
      login.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
  }

  // ─── Security Headers ──────────────────────────────────────
  const response = NextResponse.next();

  // Add security headers to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');

  // Content-Security-Policy (relaxed for development, stricter in production)
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
  }

  // ─── Add MACAL EMPIRE proprietary header ───────────────────
  response.headers.set('X-MACAL-EMPIRE', 'Protected-Content');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - public folder files
     */
    '/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp3|woff2?)$).*)',
  ],
};
