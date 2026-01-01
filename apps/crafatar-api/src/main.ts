/**
 * @fileoverview Application Entry Point
 * 
 * Main entry point for the Crafatar API server.
 * 
 * Responsibilities:
 * - Set up global error handling
 * - Initialize rate limit counter reset interval
 * - Boot the HTTP server
 * 
 * Environment Variables:
 * See config.ts for all supported environment variables.
 */

import networking from './lib/networking';
import logging from './lib/logging';
import server from './lib/server';

// ============================================================================
// Global Error Handling
// ============================================================================

/**
 * Handle uncaught exceptions
 * 
 * Logs the error and exits the process to prevent undefined behavior.
 * In production, a process manager should restart the application.
 */
process.on('uncaughtException', (err: Error) => {
  logging.error('uncaughtException', err.stack || err.toString());
  process.exit(1);
});

// ============================================================================
// Rate Limit Counter Management
// ============================================================================

/**
 * Reset the session request counter every second
 * 
 * This maintains the sliding window for rate limiting requests
 * to Mojang's session server to avoid CloudFront blocks.
 */
setInterval(networking.resetCounter, 1000);

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Boot the HTTP server
 * 
 * The server will:
 * - Listen on the configured port and IP
 * - Set up graceful shutdown handlers
 * - Start accepting requests
 */
server.boot();
