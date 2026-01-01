/**
 * @fileoverview Application Configuration Module
 * 
 * This module provides centralized configuration management for the Crafatar API.
 * All configuration values can be overridden via environment variables, with
 * sensible defaults provided for development environments.
 * 
 * Configuration is organized into logical groups:
 * - avatars: Settings for avatar image generation
 * - renders: Settings for 3D skin renders
 * - directories: File system paths for image storage
 * - caching: Cache timing and behavior settings
 * - server: HTTP server configuration
 * - sponsor: Optional sponsor content for the UI
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for avatar image generation
 */
export interface AvatarConfig {
  /** Minimum allowed avatar size in pixels */
  min_size: number;
  /** Maximum allowed avatar size in pixels (prevents DoS via large images) */
  max_size: number;
  /** Default avatar size when not specified in request */
  default_size: number;
}

/**
 * Configuration for 3D skin rendering
 */
export interface RenderConfig {
  /** Minimum allowed render scale factor */
  min_scale: number;
  /** Maximum allowed render scale factor (prevents DoS via large renders) */
  max_scale: number;
  /** Default render scale when not specified in request */
  default_scale: number;
}

/**
 * File system directory paths for image storage
 * All paths should include a trailing slash
 */
export interface DirectoryConfig {
  /** Directory for cached face images */
  faces: string;
  /** Directory for cached helm overlay images */
  helms: string;
  /** Directory for cached full skin images */
  skins: string;
  /** Directory for cached 3D render images */
  renders: string;
  /** Directory for cached cape images */
  capes: string;
}

/**
 * Cache timing and behavior configuration
 */
export interface CachingConfig {
  /** 
   * Seconds until we check if a user's skin has changed
   * Should be > 60 to comply with Mojang's rate limit
   */
  local: number;
  /** Seconds until browser should request the image again (Cache-Control max-age) */
  browser: number;
  /** 
   * If true, Redis is flushed on start
   * Useful when Redis is persistent but image storage is ephemeral (e.g., Heroku)
   */
  ephemeral: boolean;
  /** Whether Cloudflare is being used (affects error page behavior) */
  cloudflare: boolean;
}

/**
 * HTTP server configuration
 */
export interface ServerConfig {
  /** Port number to listen on */
  port: number;
  /** IP address to bind to */
  bind: string;
  /** Timeout in milliseconds for outgoing HTTP requests to Mojang */
  http_timeout: number;
  /** Enable debug logging and development features */
  debug_enabled: boolean;
  /** Include timestamps in log output */
  log_time: boolean;
  /** 
   * Rate limit per second for outgoing requests to Mojang session server
   * Requests exceeding this limit are skipped to prevent CloudFront blocks
   */
  sessions_rate_limit: number;
}

/**
 * Optional sponsor content configuration
 */
export interface SponsorConfig {
  /** HTML content for sidebar sponsor area */
  sidebar?: string;
  /** HTML content for top-right sponsor area */
  top_right?: string;
}

/**
 * Complete application configuration interface
 */
export interface Config {
  avatars: AvatarConfig;
  renders: RenderConfig;
  directories: DirectoryConfig;
  caching: CachingConfig;
  redis: string;
  server: ServerConfig;
  sponsor: SponsorConfig;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely parse an environment variable as an integer
 * @param envVar - The environment variable name
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed integer or default value
 */
function parseIntEnv(envVar: string, defaultValue: number): number {
  const value = process.env[envVar];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if an environment variable is set to 'true'
 * @param envVar - The environment variable name
 * @returns Boolean value
 */
function parseBoolEnv(envVar: string): boolean {
  return process.env[envVar] === 'true';
}

// ============================================================================
// Configuration Object
// ============================================================================

/**
 * Application configuration singleton
 * Values are loaded from environment variables with fallback defaults
 */
const config: Config = {
  // Avatar generation settings
  avatars: {
    min_size: parseIntEnv('AVATAR_MIN', 1),
    max_size: parseIntEnv('AVATAR_MAX', 512),
    default_size: parseIntEnv('AVATAR_DEFAULT', 160),
  },

  // 3D render settings
  renders: {
    min_scale: parseIntEnv('RENDER_MIN', 1),
    max_scale: parseIntEnv('RENDER_MAX', 10),
    default_scale: parseIntEnv('RENDER_DEFAULT', 6),
  },

  // Image storage directories
  directories: {
    faces: process.env['FACE_DIR'] || './images/faces/',
    helms: process.env['HELM_DIR'] || './images/helms/',
    skins: process.env['SKIN_DIR'] || './images/skins/',
    renders: process.env['RENDER_DIR'] || './images/renders/',
    capes: process.env['CAPE_DIR'] || './images/capes/',
  },

  // Cache configuration
  caching: {
    local: parseIntEnv('CACHE_LOCAL', 1200),      // 20 minutes default
    browser: parseIntEnv('CACHE_BROWSER', 3600),  // 1 hour default
    ephemeral: parseBoolEnv('EPHEMERAL_STORAGE'),
    cloudflare: parseBoolEnv('CLOUDFLARE'),
  },

  // Redis connection URL
  redis: process.env['REDIS_URL'] || 'redis://localhost:6379',

  // HTTP server settings
  server: {
    port: parseIntEnv('PORT', 3000),
    bind: process.env['BIND'] || '0.0.0.0',
    http_timeout: parseIntEnv('EXTERNAL_HTTP_TIMEOUT', 2000),
    debug_enabled: parseBoolEnv('DEBUG'),
    log_time: parseBoolEnv('LOG_TIME'),
    sessions_rate_limit: parseIntEnv('SESSIONS_RATE_LIMIT', 0),
  },

  // Sponsor content (optional)
  sponsor: {
    sidebar: process.env['SPONSOR_SIDE'],
    top_right: process.env['SPONSOR_TOP_RIGHT'],
  },
};

export default config;
