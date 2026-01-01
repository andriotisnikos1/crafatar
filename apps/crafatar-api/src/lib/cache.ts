/**
 * @fileoverview Redis Cache Module
 * 
 * Provides caching functionality using Redis for storing Minecraft user data.
 * This module handles:
 * - Connection management to Redis
 * - Storing and retrieving skin/cape hashes
 * - Managing cache timestamps for TTL-based invalidation
 * - Tracking slim vs regular skin model types
 * 
 * Cache Structure (per user):
 * - 's': Skin hash (empty string if no skin)
 * - 'c': Cape hash (empty string if no cape)
 * - 'a': Slim model flag (1 for Alex-style, 0 for Steve-style)
 * - 't': Timestamp of last update
 */

import logging from './logging';
import { createClient, RedisClientType } from 'redis';
import config from '../config';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Cached details for a Minecraft user
 */
export interface CacheDetails {
  /** Skin texture hash (null if user has no custom skin) */
  skin: string | null;
  /** Cape texture hash (null if user has no cape) */
  cape: string | null;
  /** Whether the user has a slim (Alex) model */
  slim: boolean;
  /** Timestamp when this cache entry was last updated */
  time: number;
}

// ============================================================================
// Module State
// ============================================================================

/** Redis client instance */
let redis: RedisClientType | null = null;

/** Flag to track if we're currently connecting */
let isConnecting = false;

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Initialize Redis connection
 * 
 * Sets up the Redis client with event handlers for connection lifecycle.
 * If ephemeral storage is configured, flushes all data on connect.
 * 
 * @returns Promise that resolves when connected
 */
async function connectRedis(): Promise<void> {
  if (isConnecting || redis) return;
  
  isConnecting = true;
  logging.log('Connecting to Redis...');
  
  redis = createClient({ url: config.redis });

  // Handle successful connection
  redis.on('ready', () => {
    logging.log('Redis connection established.');
    
    // Flush cache if using ephemeral storage (e.g., Heroku)
    // This prevents stale cache entries when image storage is cleared
    if (config.caching.ephemeral && redis) {
      logging.log('Storage is ephemeral, flushing Redis');
      redis.flushAll();
    }
  });

  // Handle connection errors
  redis.on('error', (err) => {
    logging.error('Redis error:', err);
  });

  // Handle disconnection
  redis.on('end', () => {
    logging.warn('Redis connection lost!');
  });

  await redis.connect();
  isConnecting = false;
}

/**
 * Get the Redis client instance
 * 
 * @returns Redis client or null if not connected
 */
export function getRedis(): RedisClientType | null {
  return redis;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Set the slim model flag for a user
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param slim - True for slim (Alex) model, false for classic (Steve) model
 */
export async function setSlim(
  rid: string,
  userId: string,
  slim: boolean
): Promise<void> {
  logging.debug(rid, 'Setting slim for', userId, 'to', slim);
  
  // Store userId in lowercase for consistent lookups
  const key = userId?.toLowerCase();
  
  if (redis && key) {
    await redis.hSet(key, 'a', Number(slim));
  }
}

/**
 * Update the cache timestamp for a user
 * 
 * This controls when the cache entry is considered stale and needs refresh.
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param temp - If true, sets timestamp so entry expires in 60 seconds
 *               (matches Mojang rate limit ban duration)
 */
export async function updateTimestamp(
  rid: string,
  userId: string,
  temp: boolean
): Promise<void> {
  logging.debug(rid, 'Updating cache timestamp (temp=' + temp + ')');
  
  // For temporary timestamps, subtract time so entry appears older
  const sub = temp ? config.caching.local - 60 : 0;
  const time = Date.now() - sub;
  
  const key = userId?.toLowerCase();
  
  if (redis && key) {
    await redis.hSet(key, 't', time);
  }
}

/**
 * Save skin/cape hashes to cache
 * 
 * Undefined values are skipped, allowing partial updates.
 */
export async function saveHash(
  rid: string,
  userId: string,
  skinHash: string | null | undefined,
  capeHash: string | null | undefined,
  slim: boolean | undefined
): Promise<void> {
  logging.debug(rid, 'Caching skin:', skinHash, 'cape:', capeHash, 'slim:', slim);
  
  const key = userId?.toLowerCase();
  if (!redis || !key) return;

  // Build fields - convert null to empty string for storage
  const fields: Record<string, string | number> = { t: Date.now() };
  
  if (skinHash !== undefined) fields['s'] = skinHash ?? '';
  if (capeHash !== undefined) fields['c'] = capeHash ?? '';
  if (slim !== undefined) fields['a'] = Number(!!slim);

  await redis.hSet(key, fields);
}

/**
 * Remove a user's cache entry
 * 
 * Used when cached data becomes invalid (e.g., file not found on disk)
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 */
export function removeHash(rid: string, userId: string): void {
  logging.debug(rid, 'Deleting hash from cache');
  
  if (redis) {
    redis.del(userId.toLowerCase());
  }
}

/**
 * Get cached details for a user
 * 
 * Retrieves all cached data for a Minecraft user including skin hash,
 * cape hash, model type, and cache timestamp.
 * 
 * @param userId - Minecraft UUID
 * @returns Cache details object, or null if user not in cache
 */
export async function getDetails(userId: string): Promise<CacheDetails | null> {
  const key = userId?.toLowerCase();
  
  if (!redis || !key) return null;

  const data = await redis.hGetAll(key);
  
  // Check if we got any data back
  if (data && Object.keys(data).length > 0) {
    return {
      skin: data['s'] === '' ? null : (data['s'] || null),
      cape: data['c'] === '' ? null : (data['c'] || null),
      slim: data['a'] === '1',
      time: Number(data['t']),
    };
  }
  
  return null;
}

// ============================================================================
// Module Initialization
// ============================================================================

// Initialize Redis connection on module load
connectRedis().catch((err) => {
  logging.error('Failed to connect to Redis:', err);
});

// ============================================================================
// Default Export
// ============================================================================

export default {
  getRedis,
  setSlim,
  updateTimestamp,
  saveHash,
  removeHash,
  getDetails,
};
