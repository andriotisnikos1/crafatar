/**
 * @fileoverview HTTP Response Handler Module
 * 
 * Handles formatting and sending HTTP responses for all API endpoints.
 * Provides consistent response handling including:
 * - Standard headers (CORS, caching, content type)
 * - ETag-based caching
 * - Proper status codes for various scenarios
 * - Error handling and logging
 * 
 * Status Codes:
 * - -2: User error (invalid input)
 * - -1: Server error (Mojang/network issues)
 * - 0: None (user has no skin, cached)
 * - 1: Cached (found on disk)
 * - 2: Downloaded (newly fetched)
 * - 3: Checked (profile re-downloaded, unchanged)
 * - 4: Server error with cached fallback
 */

import logging from './logging';
import config from '../config';
import { crc32 } from 'crc';
import { IncomingMessage, ServerResponse } from 'http';

// ============================================================================
// Constants
// ============================================================================

/**
 * Human-readable status descriptions
 */
const HUMAN_STATUS: Record<string, string> = {
  '-2': 'user error',         // e.g., invalid size
  '-1': 'server error',       // e.g., Mojang/network issues
  '0': 'none',                // cached as null (user has no skin)
  '1': 'cached',              // found on disk
  '2': 'downloaded',          // profile downloaded, skin downloaded from Mojang
  '3': 'checked',             // profile re-downloaded, skin cached or no skin
  '4': 'server error;cached', // error occurred but using cached version
};

/**
 * Error codes that should be logged without stack trace
 */
const SILENT_ERRORS = [
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'HTTPERROR',
  'RATELIMIT',
];

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Extended request interface with Crafatar-specific properties
 */
export interface CrafatarRequest {
  /** Original request headers */
  headers: Record<string, string | string[] | undefined>;
  /** HTTP method */
  method?: string;
  /** Parsed URL object */
  url: URL & {
    /** URL path split into segments */
    path_list: string[];
  };
  /** Unique request identifier */
  id: string;
  /** Request start timestamp */
  start: number;
}

/**
 * Result object for response handler
 */
export interface ResponseResult {
  /** Image status code (see module docs) */
  status?: number;
  /** Redirect URL if redirecting */
  redirect?: string;
  /** Response body content */
  body?: Buffer | string;
  /** Content-Type header value */
  type?: string;
  /** Image hash for logging/debugging */
  hash?: string;
  /** Error object if an error occurred */
  err?: Error | null;
  /** Override HTTP status code */
  code?: number;
}

// ============================================================================
// Response Handler
// ============================================================================

/**
 * Send an HTTP response with appropriate headers and status
 * 
 * This function handles all aspects of the response including:
 * - Setting standard headers (CORS, caching, content type)
 * - Computing and checking ETags for caching
 * - Logging the request/response
 * - Error handling and appropriate status codes
 * 
 * @param request - The incoming HTTP request
 * @param response - The HTTP response object
 * @param result - Result object containing response data
 */
export function sendResponse(
  request: CrafatarRequest,
  response: ServerResponse,
  result: ResponseResult
): void {
  // ========================================================================
  // Build response headers
  // ========================================================================
  
  const headers: Record<string, string | number> = {
    'Content-Type': (result.body && result.type) || 'text/plain',
    'Content-Length': Buffer.from(result.body || '').length,
    'Cache-Control': 'max-age=' + config.caching.browser,
    'Response-Time': Date.now() - request.start,
    'X-Request-ID': request.id,
    'Access-Control-Allow-Origin': '*',  // Enable CORS
  };

  // ========================================================================
  // Set up event handlers
  // ========================================================================

  // Log when response finishes
  response.on('finish', () => {
    logging.log(
      request.id,
      request.method,
      request.url.href,
      response.statusCode,
      headers['Response-Time'] + 'ms',
      '(' + (HUMAN_STATUS[String(result.status)] || '-') + ')'
    );
  });

  // Log any response errors
  response.on('error', (err) => {
    logging.error(request.id, err);
  });

  // ========================================================================
  // Handle errors
  // ========================================================================

  if (result.err) {
    const errCode = (result.err as NodeJS.ErrnoException).code;
    const silent = errCode && SILENT_ERRORS.includes(errCode);
    
    if (result.err.stack && !silent) {
      logging.error(request.id, result.err.stack);
    } else if (silent) {
      logging.warn(request.id, result.err);
    } else {
      logging.error(request.id, result.err);
    }
    
    result.status = -1;
  }

  // ========================================================================
  // Add storage type header
  // ========================================================================

  if (result.status !== undefined && result.status !== null) {
    headers['X-Storage-Type'] = HUMAN_STATUS[String(result.status)];
  }

  // ========================================================================
  // Handle ETag caching
  // ========================================================================

  // Compute ETag using CRC32
  const etag = '"' + crc32(result.body || '').toString() + '"';
  const incomingEtag = request.headers['if-none-match'];

  // Return 304 if ETag matches or on server error (use client's cached version)
  // Don't return 304 when debugging is enabled
  if (
    incomingEtag &&
    (incomingEtag === etag || (result.status === -1 && !config.server.debug_enabled))
  ) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  // ========================================================================
  // Handle redirects
  // ========================================================================

  if (result.redirect) {
    headers['Location'] = result.redirect;
    response.writeHead(307, headers);
    response.end();
    return;
  }

  // ========================================================================
  // Determine status code and send response
  // ========================================================================

  if (result.status === -2) {
    // User error (invalid input)
    response.writeHead(result.code || 422, headers);
  } else if (result.status === -1) {
    // Server error
    headers['Cache-Control'] = 'no-cache, max-age=0';
    
    // If we have cached content despite the error, serve it with warning
    if (result.body && result.hash && !result.hash.startsWith('mhf_')) {
      headers['Warning'] = '110 Crafatar "Response is Stale"';
      headers['Etag'] = etag;
      result.code = result.code || 200;
    }
    
    // Handle file not found errors
    if (result.err && (result.err as NodeJS.ErrnoException).code === 'ENOENT') {
      result.code = result.code || 500;
    }
    
    // Default error code
    // Don't use 502 on Cloudflare as they show their own error page
    // https://support.cloudflare.com/hc/en-us/articles/200172706
    if (!result.code) {
      result.code = config.caching.cloudflare ? 500 : 502;
    }
    
    response.writeHead(result.code, headers);
  } else {
    // Success or cached response
    if (result.body) {
      // Add warning header if using cached version after revalidation failure
      if (result.status === 4) {
        headers['Warning'] = '111 Crafatar "Revalidation Failed"';
      }
      
      headers['Etag'] = etag;
      response.writeHead(200, headers);
    } else {
      // No content (user has no skin/cape)
      response.writeHead(404, headers);
    }
  }

  response.end(result.body);
}

// ============================================================================
// Default Export
// ============================================================================

export default sendResponse;
