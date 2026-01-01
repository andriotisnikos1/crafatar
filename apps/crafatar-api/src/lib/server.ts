/**
 * @fileoverview HTTP Server Module
 * 
 * Main HTTP server implementation for the Crafatar API.
 * Handles request routing, static asset serving, and graceful shutdown.
 * 
 * Request Flow:
 * 1. Parse and normalize URL
 * 2. Check server load (reject if too busy)
 * 3. Route to appropriate handler based on path
 * 4. Send response with proper headers
 * 
 * Routes:
 * - /: Index page (documentation)
 * - /avatars/{uuid}: Avatar images
 * - /skins/{uuid}: Full skin images
 * - /renders/{type}/{uuid}: 3D renders
 * - /capes/{uuid}: Cape images
 * - /*: Static assets from /public
 */

import sendResponse, { CrafatarRequest, ResponseResult } from './response';
import helpers from './helpers';
import toobusy from 'toobusy-js';
import logging from './logging';
import config from '../config';
import * as http from 'http';
import mime from 'mime';
import * as path from 'path';
import * as fs from 'fs';

// Import route handlers
import indexRoute from '../routes/index';
import avatarsRoute from '../routes/avatars';
import skinsRoute from '../routes/skins';
import rendersRoute from '../routes/renders';
import capesRoute from '../routes/capes';

// ============================================================================
// Module State
// ============================================================================

/** HTTP server instance */
let server: http.Server | null = null;

// ============================================================================
// Route Configuration
// ============================================================================

/**
 * Route handlers mapped by path segment
 */
const routes: Record<string, (req: CrafatarRequest, callback: (result: ResponseResult) => void) => void> = {
  '': indexRoute,
  'avatars': avatarsRoute,
  'skins': skinsRoute,
  'renders': rendersRoute,
  'capes': capesRoute,
};

// ============================================================================
// Static Asset Serving
// ============================================================================

/**
 * Serve static assets from the lib/public directory
 * 
 * Validates the path to prevent directory traversal attacks.
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
function assetRequest(
  req: CrafatarRequest,
  callback: (result: ResponseResult) => void
): void {
  // Build the absolute file path
  const filename = path.join(__dirname, 'public', ...req.url.path_list);
  
  // Compute relative path to check for traversal
  const publicDir = path.join(__dirname, 'public');
  const relative = path.relative(publicDir, filename);

  // Security check: ensure path doesn't escape the public directory
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    // Check if file exists
    fs.access(filename, (fsErr) => {
      if (!fsErr) {
        // Read and serve the file
        fs.readFile(filename, (err, data) => {
          callback({
            body: data,
            type: mime.getType(filename) || 'application/octet-stream',
            err: err,
          });
        });
      } else {
        // File not found
        callback({
          body: 'Not found',
          status: -2,
          code: 404,
        });
      }
    });
  } else {
    // Path traversal attempt
    callback({
      body: 'Forbidden',
      status: -2,
      code: 403,
    });
  }
}

// ============================================================================
// Request Handling
// ============================================================================

/**
 * Generate a 12-character random request ID
 * 
 * @returns Random alphanumeric string
 */
function requestId(): string {
  return Math.random().toString(36).substring(2, 14);
}

/**
 * Split a URL path into segments
 * 
 * @param pathname - URL pathname (e.g., '/avatars/uuid')
 * @returns Array of path segments (e.g., ['avatars', 'uuid'])
 */
function pathList(pathname: string): string[] {
  const list = pathname.split('/');
  list.shift(); // Remove leading empty string
  return list;
}

/**
 * Main request handler
 * 
 * Routes incoming requests to the appropriate handler and
 * ensures proper error handling and response formatting.
 * 
 * @param req - Incoming HTTP request
 * @param res - HTTP response object
 */
function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Cast and extend request with Crafatar-specific properties
  const crafatarReq = req as unknown as CrafatarRequest;

  // Parse and normalize URL
  const rawUrl = new URL(decodeURI(req.url || '/'), 'http://' + req.headers['host']);
  rawUrl.pathname = path.resolve('/', rawUrl.pathname);
  
  // Extend URL with path list
  crafatarReq.url = rawUrl as CrafatarRequest['url'];
  crafatarReq.url.path_list = pathList(rawUrl.pathname);
  
  // Assign request metadata
  crafatarReq.id = requestId();
  crafatarReq.start = Date.now();
  crafatarReq.headers = req.headers as Record<string, string | string[] | undefined>;

  const localPath = crafatarReq.url.path_list[0];
  logging.debug(crafatarReq.id, req.method, crafatarReq.url.href);

  // ========================================================================
  // Server load check
  // ========================================================================

  toobusy.maxLag(200);
  
  if (toobusy() && !process.env['TRAVIS']) {
    sendResponse(crafatarReq, res, {
      status: -1,
      body: 'Server is over capacity :/',
      err: new Error('Too busy'),
      code: 503,
    });
    return;
  }

  // ========================================================================
  // Method validation
  // ========================================================================

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendResponse(crafatarReq, res, {
      status: -2,
      body: 'Method Not Allowed',
      code: 405,
    });
    return;
  }

  // ========================================================================
  // Request routing
  // ========================================================================

  try {
    // Check if there's a route handler for this path
    const routeHandler = routes[localPath];

    if (routeHandler) {
      routeHandler(crafatarReq, (result) => {
        sendResponse(crafatarReq, res, result);
      });
    } else {
      // No route found - try serving as static asset
      assetRequest(crafatarReq, (result) => {
        sendResponse(crafatarReq, res, result);
      });
    }
  } catch (e) {
    // Handle unexpected errors
    const error = JSON.stringify(req.headers) + '\n' + (e as Error).stack;
    
    sendResponse(crafatarReq, res, {
      status: -1,
      body: config.server.debug_enabled ? error : 'Internal Server Error',
      err: new Error(error),
    });
  }
}

// ============================================================================
// Server Lifecycle
// ============================================================================

/**
 * Start the HTTP server
 * 
 * @param callback - Called when server is listening
 */
export function boot(callback?: () => void): void {
  const port = config.server.port;
  const bindIp = config.server.bind;

  server = http.createServer(requestHandler).listen(port, bindIp, () => {
    logging.log('Server running on http://' + bindIp + ':' + port + '/');
    if (callback) {
      callback();
    }
  });

  // ========================================================================
  // Graceful shutdown handling
  // ========================================================================

  process.on('SIGTERM', () => {
    logging.warn('Got SIGTERM, no longer accepting new connections!');

    // Force quit after 30 seconds
    setTimeout(() => {
      logging.error('Dropping connections after 30s. Force quit.');
      process.exit(1);
    }, 30000);

    // Wait for existing connections to close
    server?.close(() => {
      logging.log('All connections closed, shutting down.');
      process.exit();
    });
  });
}

/**
 * Stop the HTTP server
 * 
 * @param callback - Called when server is closed
 */
export function close(callback?: () => void): void {
  helpers.stoplog();
  server?.close(callback);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  boot,
  close,
};
