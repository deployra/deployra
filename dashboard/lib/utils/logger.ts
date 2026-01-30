import { NextRequest } from 'next/server';

// Simple logger with different log levels
export const logger = {
  debug: (message: string, meta?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${message}`, meta ? meta : '');
    }
  },
  
  info: (message: string, meta?: any) => {
    console.info(`[INFO] ${message}`, meta ? meta : '');
  },
  
  warn: (message: string, meta?: any) => {
    console.warn(`[WARN] ${message}`, meta ? meta : '');
  },
  
  error: (message: string, meta?: any) => {
    console.error(`[ERROR] ${message}`, meta ? meta : '');
  },
  
  // Special method for request logging
  request: (req: NextRequest) => {
    const { method, nextUrl, headers } = req;
    const userAgent = headers.get('user-agent') || 'unknown';
    const referer = headers.get('referer') || 'direct';
    const clientIp = headers.get('x-forwarded-for') || 'unknown';
    
    console.info(
      `[REQUEST] ${new Date().toISOString()} ${clientIp} "${method} ${nextUrl.pathname}${nextUrl.search}" "${referer}" "${userAgent}"`
    );
  }
};
