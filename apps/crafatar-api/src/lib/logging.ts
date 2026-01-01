/**
 * @fileoverview Logging Utility Module
 * 
 * Provides centralized logging functionality with multiple severity levels.
 * Supports conditional debug logging based on configuration.
 * 
 * Log Levels:
 * - INFO:  General operational messages
 * - WARN:  Warning conditions that should be noted
 * - ERROR: Error conditions requiring attention
 * - DEBUG: Detailed debugging information (only when debug_enabled)
 * 
 * Features:
 * - Optional timestamps (controlled by config.server.log_time)
 * - Multi-line log message support
 * - Consistent log format across all levels
 */

import config from '../config';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Generic logging function signature
 */
type LogFunction = (...args: unknown[]) => void;

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Join all arguments into a single space-separated string
 * Converts all values to strings for consistent output
 * 
 * @param args - Array of arguments to join
 * @returns Single joined string
 */
function joinArgs(args: unknown[]): string {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    values.push(String(args[i]));
  }
  return values.join(' ');
}

/**
 * Core logging function that formats and outputs log messages
 * 
 * @param level - Log level prefix (e.g., 'INFO', 'WARN', 'ERROR', 'DEBUG')
 * @param args - Arguments to log
 * @param logger - Console function to use for output (defaults to console.log)
 */
function log(level: string, args: unknown[], logger: LogFunction = console.log): void {
  // Optionally prepend timestamp based on configuration
  const time = config.server.log_time ? new Date().toISOString() + ' ' : '';
  
  // Split message by newlines to handle multi-line logs properly
  const lines = joinArgs(args).split('\n');
  
  // Output each line with consistent formatting
  for (let i = 0; i < lines.length; i++) {
    logger(time, level + ':', lines[i]);
  }
}

// ============================================================================
// Public Logging Functions
// ============================================================================

/**
 * Log an informational message
 * Use for general operational status messages
 * 
 * @param args - Values to log
 * @example
 * logging.log('Server started on port', 3000);
 */
export function logInfo(...args: unknown[]): void {
  log(' INFO', args);
}

/**
 * Log a warning message
 * Use for conditions that are unusual but not necessarily errors
 * 
 * @param args - Values to log
 * @example
 * logging.warn('Cache miss for user', userId);
 */
export function warn(...args: unknown[]): void {
  log(' WARN', args, console.warn);
}

/**
 * Log an error message
 * Use for error conditions that need attention
 * 
 * @param args - Values to log
 * @example
 * logging.error('Failed to connect to Redis:', error);
 */
export function error(...args: unknown[]): void {
  log('ERROR', args, console.error);
}

/**
 * Log a debug message (only when debug mode is enabled)
 * Use for detailed information useful during development/debugging
 * 
 * This function is a no-op when config.server.debug_enabled is false,
 * ensuring zero performance impact in production.
 * 
 * @param args - Values to log
 * @example
 * logging.debug(requestId, 'Processing avatar request for', userId);
 */
export const debug: LogFunction = config.server.debug_enabled
  ? (...args: unknown[]) => log('DEBUG', args)
  : () => { /* no-op when debug disabled */ };

// ============================================================================
// Default Export
// ============================================================================

/**
 * Logging module default export
 * Provides all logging functions in a single object for convenient imports
 */
export default {
  log: logInfo,
  warn,
  error,
  debug,
};
