/**
 * @fileoverview Network Communication Module
 * 
 * Handles all HTTP requests to external services, primarily Mojang's APIs.
 * Implements rate limiting to avoid CloudFront blocks and provides
 * consistent error handling for various HTTP response scenarios.
 * 
 * External APIs Used:
 * - Mojang Session Server: Player profile data (skin/cape URLs)
 * - Minecraft Texture Server: Actual skin/cape images
 * 
 * Features:
 * - Automatic rate limiting for session server requests
 * - Proper handling of various HTTP status codes
 * - Profile data parsing with texture URL extraction
 */

import logging from './logging';
import config from '../config';
import skins from './skins';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { getNestedProperty } from './object-utils';

// ============================================================================
// Constants
// ============================================================================

/** Mojang's session server API endpoint for player profiles */
const SESSION_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';

/** Minecraft texture server URL for downloading skins/capes */
const TEXTURES_URL = 'https://textures.minecraft.net/texture/';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for HTTP GET requests
 */
export interface GetOptions {
  /** Response encoding (omit for Buffer response) */
  encoding?: BufferEncoding;
}

/**
 * Mojang profile property structure
 */
interface ProfileProperty {
  name: string;
  value: string;
}

/**
 * Mojang profile response structure
 */
interface MojangProfile {
  id?: string;
  name?: string;
  properties?: ProfileProperty[];
  textures?: {
    SKIN?: {
      url?: string;
      metadata?: {
        model?: string;
      };
    };
    CAPE?: {
      url?: string;
    };
  };
}

/**
 * Custom error with HTTP-specific properties
 */
interface HttpError extends Error {
  code: string;
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Timestamps of recent requests to the session server
 * Used to implement rate limiting to avoid CloudFront blocks
 */
let sessionRequests: number[] = [];

/**
 * Count requests made to session server in the last 1000ms
 * 
 * @returns Number of recent requests
 */
function reqCount(): number {
  const cutoff = Date.now() - 1000;
  const index = sessionRequests.findIndex((i) => i >= cutoff);
  
  if (index >= 0) {
    return sessionRequests.length - index;
  }
  return 0;
}

/**
 * Clear old session request timestamps
 * Should be called every 1000ms to maintain accurate rate limiting
 */
export function resetCounter(): void {
  const count = reqCount();
  
  if (count) {
    const logfunc = count >= config.server.sessions_rate_limit 
      ? logging.warn 
      : logging.debug;
    logfunc('Clearing old session requests (count was ' + count + ')');
    sessionRequests.splice(0, sessionRequests.length - count);
  } else {
    sessionRequests = [];
  }
}

// ============================================================================
// HTTP Request Functions
// ============================================================================

/**
 * Perform an HTTP GET request with configurable options
 * 
 * Handles rate limiting for session server requests and provides
 * consistent error handling for various HTTP status codes.
 * 
 * @param rid - Request ID for logging
 * @param url - URL to request
 * @param options - Request options
 * @param callback - Called with (body, response, error)
 */
export function getFromOptions(
  rid: string,
  url: string,
  options: GetOptions,
  callback: (
    body: Buffer | string | null,
    response: http.IncomingMessage | null,
    error: Error | null
  ) => void
): void {
  const isSessionReq = config.server.sessions_rate_limit && url.startsWith(SESSION_URL);

  // Check rate limit before making session server requests
  if (isSessionReq && reqCount() >= config.server.sessions_rate_limit) {
    const e = new Error('Skipped, rate limit exceeded') as HttpError;
    e.name = 'HTTP';
    e.code = 'RATELIMIT';

    // Create a simple mock response object
    const mockResponse = {
      statusCode: 403,
    } as http.IncomingMessage;

    callback(null, mockResponse, e);
    return;
  }

  // Track this request for rate limiting
  if (isSessionReq) {
    sessionRequests.push(Date.now());
  }

  // Parse URL and determine protocol
  const parsedUrl = new URL(url);
  const httpModule = parsedUrl.protocol === 'https:' ? https : http;

  const requestOptions: https.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'GET',
    headers: {
      'User-Agent': 'Crafatar (+https://crafatar.com)',
    },
    timeout: config.server.http_timeout,
  };

  const req = httpModule.request(requestOptions, (response) => {
    const chunks: Buffer[] = [];

    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    response.on('end', () => {
      let body: Buffer | string | null = Buffer.concat(chunks);
      const code = response.statusCode;

      // Log the request result
      const logfunc = code && (code < 400 || code === 404) 
        ? logging.debug 
        : logging.warn;
      logfunc(rid, url, code, http.STATUS_CODES[code || 0]);

      // Create error object for non-success statuses
      const e = new Error(String(code)) as HttpError;
      e.name = 'HTTP';
      e.code = 'HTTPERROR';

      let error: Error | null = null;

      // Handle different HTTP status codes
      switch (code) {
        case 200:
        case 301:
        case 302:
        case 307:
        case 308:
          // Success - keep body as is
          break;

        case 204:  // No content (Mojang uses like 404)
        case 404:
          // Can be cached as null
          body = null;
          break;

        case 403:  // CloudFront block
        case 429:  // Rate limit
        case 500:
        case 502:  // CloudFront can't reach origin
        case 503:
        case 504:
          // Don't cache these errors
          error = e;
          body = null;
          break;

        default:
          // Unexpected status code
          if (code && code >= 400) {
            logging.error(rid, 'Unexpected response:', code, body?.toString());
          }
          error = e;
          body = null;
          break;
      }

      // Handle empty response
      if (body && body.length === 0) {
        body = null;
      }

      // Convert to string if encoding specified
      if (body && options.encoding) {
        body = body.toString(options.encoding);
      }

      callback(body, response, error);
    });
  });

  // Handle request errors
  req.on('error', (err) => {
    logging.warn(rid, url, err.message);
    callback(null, null, err);
  });

  req.on('timeout', () => {
    req.destroy();
    const e = new Error('Request timed out') as HttpError;
    e.code = 'ETIMEDOUT';
    callback(null, null, e);
  });

  req.end();
}

/**
 * Simple GET request helper (no encoding options)
 * 
 * @param rid - Request ID for logging
 * @param url - URL to request
 * @param callback - Called with (body, response, error)
 */
export function getFrom(
  rid: string,
  url: string,
  callback: (
    body: Buffer | null,
    response: http.IncomingMessage | null,
    error: Error | null
  ) => void
): void {
  getFromOptions(rid, url, {}, (body, response, err) => {
    callback(body as Buffer | null, response, err);
  });
}

// ============================================================================
// Profile Data Functions
// ============================================================================

/**
 * Extract texture URL and model type from a Mojang profile
 * 
 * Mojang encodes texture data in a base64 JSON blob within the profile.
 * This function decodes that and extracts the requested texture URL.
 * 
 * @param profile - Mojang profile object
 * @param type - 'SKIN' or 'CAPE'
 * @param callback - Called with (error, url, isSlim)
 */
export function getUuidInfo(
  profile: MojangProfile | null,
  type: 'SKIN' | 'CAPE',
  callback: (err: Error | null, url: string | null, slim: boolean) => void
): void {
  if (!profile) {
    callback(null, null, false);
    return;
  }

  // Look for the textures property in the profile
  const properties = profile.properties || [];
  let parsedProfile: MojangProfile = profile;

  for (const prop of properties) {
    if (prop.name === 'textures') {
      // Decode the base64-encoded JSON texture data
      const json = Buffer.from(prop.value, 'base64').toString();
      try {
        parsedProfile = JSON.parse(json);
      } catch (e) {
        // If parsing fails, continue with original profile
      }
    }
  }

  // Extract the texture URL using dot notation
  const url = getNestedProperty<string>(
    parsedProfile as unknown as Record<string, unknown>,
    'textures.' + type + '.url'
  );

  // Check for slim model (only relevant for skins)
  let slim = false;
  if (type === 'SKIN') {
    const model = getNestedProperty<string>(
      parsedProfile as unknown as Record<string, unknown>,
      'textures.SKIN.metadata.model'
    );
    slim = model === 'slim';
  }

  callback(null, url || null, slim);
}

/**
 * Fetch a player's profile from Mojang's session server
 * 
 * @param rid - Request ID for logging
 * @param uuid - Player UUID (no dashes)
 * @param callback - Called with (error, profile)
 */
export function getProfile(
  rid: string,
  uuid: string,
  callback: (err: Error | null, profile: MojangProfile | null) => void
): void {
  getFromOptions(rid, SESSION_URL + uuid, { encoding: 'utf8' }, (body, response, err) => {
    try {
      const profile = body ? JSON.parse(body as string) : null;
      callback(err, profile);
    } catch (e) {
      if (e instanceof SyntaxError) {
        logging.warn(rid, 'Failed to parse JSON', e);
        logging.debug(rid, body);
        callback(err, null);
      } else {
        throw e;
      }
    }
  });
}

/**
 * Get skin URL and model type for a player
 * 
 * @param rid - Request ID for logging
 * @param userId - Player UUID
 * @param profile - Previously fetched Mojang profile
 * @param callback - Called with (error, url, isSlim)
 */
export function getSkinInfo(
  rid: string,
  userId: string,
  profile: MojangProfile | null,
  callback: (err: Error | null, url: string | null, slim: boolean) => void
): void {
  getUuidInfo(profile, 'SKIN', callback);
}

/**
 * Get cape URL for a player
 * 
 * @param rid - Request ID for logging
 * @param userId - Player UUID
 * @param profile - Previously fetched Mojang profile
 * @param callback - Called with (error, url)
 */
export function getCapeUrl(
  rid: string,
  userId: string,
  profile: MojangProfile | null,
  callback: (err: Error | null, url: string | null) => void
): void {
  getUuidInfo(profile, 'CAPE', (err, url) => {
    callback(err, url);
  });
}

/**
 * Download a texture from Mojang's texture server and save to disk
 * 
 * @param rid - Request ID for logging
 * @param texHash - Texture hash (filename on texture server)
 * @param outpath - Local file path to save the image
 * @param callback - Called with (error, response, imageBuffer)
 */
export function saveTexture(
  rid: string,
  texHash: string | null,
  outpath: string,
  callback: (
    err: Error | null,
    response: http.IncomingMessage | null,
    img: Buffer | null
  ) => void
): void {
  if (!texHash) {
    callback(null, null, null);
    return;
  }

  const textureUrl = TEXTURES_URL + texHash;

  getFrom(rid, textureUrl, (img, response, err) => {
    if (err || !img) {
      callback(err, response, null);
      return;
    }

    skins.saveImage(img, outpath, (saveErr) => {
      callback(saveErr, response, img);
    });
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  resetCounter,
  getFromOptions,
  getFrom,
  getUuidInfo,
  getProfile,
  getSkinInfo,
  getCapeUrl,
  saveTexture,
};
