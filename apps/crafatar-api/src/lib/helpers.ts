/**
 * @fileoverview Image Helper Functions Module
 * 
 * Provides high-level functions for retrieving and processing Minecraft images.
 * This module coordinates between cache, networking, and image processing modules
 * to efficiently serve avatars, skins, renders, and capes.
 * 
 * Key Features:
 * - UUID validation
 * - Cache-aware image retrieval
 * - Request queuing for simultaneous requests
 * - Automatic fallback to cached data on errors
 * 
 * Image Status Codes:
 * - -1: Server error (Mojang/network issues)
 * - 0: None (cached as null, user has no skin)
 * - 1: Cached (found on disk)
 * - 2: Downloaded (newly fetched from Mojang)
 * - 3: Checked (profile re-downloaded, skin cached or no skin)
 * - 4: Server error with cached fallback
 */

import networking from './networking';
import logging from './logging';
import renders from './renders';
import config from '../config';
import cache, { CacheDetails } from './cache';
import skins from './skins';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

// Promisified fs functions for cleaner async code
const fsAccess = promisify(fs.access);
const fsWriteFile = promisify(fs.writeFile);

// ============================================================================
// Constants
// ============================================================================

/** Regex pattern for valid Minecraft UUIDs (32 hex characters, no dashes) */
const VALID_USER_ID = /^[0-9a-fA-F]{32}$/;

/** Regex pattern to extract hash from texture URLs */
const HASH_PATTERN = /[0-9a-f]+$/;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Callback for image retrieval operations
 */
type ImageCallback = (
  err: Error | null,
  hash: string | null,
  slim: boolean
) => void;

/**
 * Request queue entry for managing simultaneous requests
 */
interface QueuedRequest {
  callback: ImageCallback;
}

// ============================================================================
// Request Queue Management
// ============================================================================

/**
 * Queue for managing simultaneous requests for the same user
 * 
 * When multiple requests come in for the same user, only the first one
 * actually fetches data. Others wait and receive the same result.
 * This prevents rate limit issues and reduces redundant network calls.
 */
const requests: {
  skin: Record<string, QueuedRequest[]>;
  cape: Record<string, QueuedRequest[]>;
} = {
  skin: {},
  cape: {},
};

/**
 * Interval for logging pending request counts
 */
let logInterval: NodeJS.Timeout | null = null;

/**
 * Start the periodic logging of pending requests
 */
function startLogInterval(): void {
  if (logInterval) return;
  
  logInterval = setInterval(() => {
    const skinReqs = Object.keys(requests.skin).length;
    const capeReqs = Object.keys(requests.cape).length;
    
    if (skinReqs || capeReqs) {
      logging.log(
        'Currently waiting for',
        skinReqs,
        'skin requests and',
        capeReqs,
        'cape requests.'
      );
    }
  }, 1000);
}

// Start logging on module load
startLogInterval();

/**
 * Stop the periodic logging interval
 * Called when shutting down the server
 */
export function stoplog(): void {
  if (logInterval) {
    clearInterval(logInterval);
    logInterval = null;
  }
}

/**
 * Add a request to the queue for a specific user and type
 * 
 * @param userId - Minecraft UUID
 * @param type - 'skin' or 'cape'
 * @param callback - Callback to invoke when data is ready
 */
function pushRequest(
  userId: string,
  type: 'skin' | 'cape',
  callback: ImageCallback
): void {
  // Prefix with '!' to avoid collisions with special object properties
  const safeKey = '!' + userId;
  
  if (!requests[type][safeKey]) {
    requests[type][safeKey] = [];
  }
  
  requests[type][safeKey].push({ callback });
}

/**
 * Resume all queued requests for a user with the fetched data
 * 
 * @param userId - Minecraft UUID
 * @param type - 'skin' or 'cape'
 * @param err - Error if any occurred
 * @param hash - Image hash
 * @param slim - Whether the skin is slim model
 */
function resume(
  userId: string,
  type: 'skin' | 'cape',
  err: Error | null,
  hash: string | null,
  slim: boolean
): void {
  const safeKey = '!' + userId;
  const callbacks = requests[type][safeKey];
  
  if (!callbacks) return;
  
  if (callbacks.length > 1) {
    logging.debug(callbacks.length, 'simultaneous requests for', userId);
  }

  // Call all waiting callbacks
  for (const { callback } of callbacks) {
    callback(err, hash, slim);
  }

  // Clean up the queue
  delete requests[type][safeKey];
}

// ============================================================================
// Hash Extraction
// ============================================================================

/**
 * Extract the texture hash from a Mojang texture URL
 * 
 * @param url - Full texture URL from Mojang
 * @returns Lowercase hash string
 */
function getHash(url: string): string {
  const match = HASH_PATTERN.exec(url);
  return match ? match[0].toLowerCase() : '';
}

// ============================================================================
// Skin/Cape Storage Functions
// ============================================================================

/**
 * Check if a file exists (async helper)
 */
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fsAccess(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download and process skin image
 * Handles: downloading, saving skin, extracting face and helm
 */
async function downloadAndProcessSkin(
  rid: string,
  url: string,
  skinHash: string,
  slim: boolean
): Promise<{ error: Error | null; hash: string | null }> {
  const facepath = path.join(config.directories.faces, skinHash + '.png');
  const helmpath = path.join(config.directories.helms, skinHash + '.png');
  const skinpath = path.join(config.directories.skins, skinHash + '.png');

  // Check if already processed
  if (await fileExists(facepath)) {
    logging.debug(rid, 'Skin already exists, not downloading');
    return { error: null, hash: skinHash };
  }

  // Download the skin
  return new Promise((resolve) => {
    networking.getFrom(rid, url, (img, response, netErr) => {
      if (netErr || !img) {
        resolve({ error: netErr, hash: null });
        return;
      }

      // Process skin: save, extract face, extract helm
      skins.saveImage(img, skinpath, (saveErr) => {
        if (saveErr) {
          resolve({ error: saveErr, hash: null });
          return;
        }

        skins.extractFace(img, facepath, (faceErr) => {
          if (faceErr) {
            resolve({ error: faceErr, hash: null });
            return;
          }
          logging.debug(rid, 'Face extracted');

          skins.extractHelm(rid, facepath, img, helmpath, (helmErr) => {
            logging.debug(rid, 'Helm extracted');
            resolve({ error: helmErr, hash: skinHash });
          });
        });
      });
    });
  });
}

/**
 * Download and store a skin image with extracted face and helm
 */
function storeSkin(
  rid: string,
  userId: string,
  profile: Record<string, unknown> | null,
  cacheDetails: CacheDetails | null,
  callback: ImageCallback
): void {
  networking.getSkinInfo(rid, userId, profile, async (err, url, slim) => {
    // Use cached slim value on error
    const effectiveSlim = err ? (cacheDetails?.slim ?? false) : slim;

    if (err || !url) {
      callback(err, null, false);
      return;
    }

    const skinHash = getHash(url);

    // Check if cache already has this hash (skin unchanged)
    if (cacheDetails?.skin === skinHash) {
      try {
        await cache.updateTimestamp(rid, userId, false);
        callback(null, skinHash, effectiveSlim);
      } catch (cacheErr) {
        callback(cacheErr as Error, skinHash, effectiveSlim);
      }
      return;
    }

    logging.debug(rid, 'New skin hash:', skinHash);
    
    const result = await downloadAndProcessSkin(rid, url, skinHash, effectiveSlim);
    callback(result.error, result.hash, effectiveSlim);
  });
}

/**
 * Download and store a cape image
 */
function storeCape(
  rid: string,
  userId: string,
  profile: Record<string, unknown> | null,
  cacheDetails: CacheDetails | null,
  callback: ImageCallback
): void {
  networking.getCapeUrl(rid, userId, profile, async (err, url) => {
    if (err || !url) {
      callback(err, null, false);
      return;
    }

    const capeHash = getHash(url);

    // Check if cache already has this hash
    if (cacheDetails?.cape === capeHash) {
      try {
        await cache.updateTimestamp(rid, userId, false);
        callback(null, capeHash, false);
      } catch (cacheErr) {
        callback(cacheErr as Error, capeHash, false);
      }
      return;
    }

    logging.debug(rid, 'New cape hash:', capeHash);
    const capepath = path.join(config.directories.capes, capeHash + '.png');

    // Check if cape already exists
    if (await fileExists(capepath)) {
      logging.debug(rid, 'Cape already exists, not downloading');
      callback(null, capeHash, false);
      return;
    }

    // Download and save the cape
    networking.getFrom(rid, url, (img, response, netErr) => {
      if (netErr || !img) {
        callback(netErr, null, false);
        return;
      }

      skins.saveImage(img, capepath, (saveErr) => {
        logging.debug(rid, 'Cape saved');
        callback(saveErr, capeHash, false);
      });
    });
  });
}

/**
 * Download and store images for a user with request queuing
 * 
 * Handles simultaneous requests by queuing them and only making
 * one actual request to Mojang per user.
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param cacheDetails - Existing cache entry
 * @param type - 'skin' or 'cape'
 * @param callback - Called with (error, hash, isSlim)
 */
function storeImages(
  rid: string,
  userId: string,
  cacheDetails: CacheDetails | null,
  type: 'skin' | 'cape',
  callback: ImageCallback
): void {
  // Check if there's already a pending request for this user
  if (requests[type]['!' + userId]) {
    logging.debug(rid, 'Adding to request queue');
    pushRequest(userId, type, callback);
    return;
  }

  // First request for this user - add to queue and fetch
  pushRequest(userId, type, callback);

  // Get profile from Mojang
  networking.getProfile(rid, userId, (err, profile) => {
    if (err || !profile) {
      if (!err && !profile) {
        // UUID exists but has no profile (no skin or cape)
        cache.saveHash(rid, userId, null, null, undefined).then(() => {
          resume(userId, 'skin', null, null, false);
          resume(userId, 'cape', null, null, false);
        }).catch((cacheErr) => {
          resume(userId, 'skin', cacheErr, null, false);
          resume(userId, 'cape', cacheErr, null, false);
        });
      } else {
        // Error occurred - don't cache, can retry in 60 seconds
        resume(userId, type, err, null, false);
      }
      return;
    }

    // Profile retrieved successfully - fetch skin and cape
    storeSkin(rid, userId, profile as unknown as Record<string, unknown>, cacheDetails, (skinErr, skinHash, slim) => {
      if (skinErr && !skinHash) {
        resume(userId, 'skin', skinErr, null, slim);
      } else {
        cache.saveHash(rid, userId, skinHash, undefined, slim).then(() => {
          resume(userId, 'skin', skinErr, skinHash, slim);
        }).catch((cacheErr) => {
          resume(userId, 'skin', skinErr || cacheErr, skinHash, slim);
        });
      }
    });

    storeCape(rid, userId, profile as unknown as Record<string, unknown>, cacheDetails, (capeErr, capeHash) => {
      if (capeErr && !capeHash) {
        resume(userId, 'cape', capeErr, capeHash, false);
      } else {
        cache.saveHash(rid, userId, undefined, capeHash, undefined).then(() => {
          resume(userId, 'cape', capeErr, capeHash, false);
        }).catch((cacheErr) => {
          resume(userId, 'cape', capeErr || cacheErr, capeHash, false);
        });
      }
    });
  });
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Validate if a string is a valid Minecraft UUID
 * 
 * @param userId - String to validate
 * @returns True if valid 32-character hex UUID
 */
export function idValid(userId: string): boolean {
  return VALID_USER_ID.test(userId);
}

/**
 * Get image hash for a user, checking cache first
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param type - 'skin' or 'cape'
 * @param callback - Called with (error, status, hash, isSlim)
 */
export function getImageHash(
  rid: string,
  userId: string,
  type: 'skin' | 'cape',
  callback: (err: Error | null, status: number, hash: string | null, slim: boolean) => void
): void {
  cache.getDetails(userId).then((cacheDetails) => {
    let cachedHash: string | null = null;
    
    if (cacheDetails !== null) {
      cachedHash = type === 'skin' ? cacheDetails.skin : cacheDetails.cape;
    }

    // Check if cache entry exists and is fresh
    if (
      cacheDetails &&
      cacheDetails[type] !== undefined &&
      cacheDetails.time + config.caching.local * 1000 >= Date.now()
    ) {
      // Use cached image
      logging.debug(rid, 'userId cached & recently updated');
      callback(null, cachedHash ? 1 : 0, cachedHash, cacheDetails.slim);
      return;
    }

    // Cache miss or stale - need to download
    if (cacheDetails && cacheDetails[type] !== undefined) {
      logging.debug(rid, 'userId cached, but too old');
      logging.debug(rid, JSON.stringify(cacheDetails));
    } else {
      logging.debug(rid, 'userId not cached');
    }

    // Fetch new data
    storeImages(rid, userId, cacheDetails, type, (storeErr, newHash, slim) => {
      if (storeErr) {
        // Error occurred but we might have cached data
        const ratelimited = (storeErr as NodeJS.ErrnoException).code === 'RATELIMIT';
        
        cache.updateTimestamp(rid, userId, !ratelimited).then(() => {
          callback(storeErr, 4, cacheDetails ? cachedHash : null, slim);
        }).catch((cacheErr) => {
          callback(cacheErr || storeErr, 4, cacheDetails ? cachedHash : null, slim);
        });
      } else {
        // Determine status based on whether hash changed
        const status = cacheDetails && cachedHash === newHash ? 3 : 2;
        logging.debug(rid, 'Cached hash:', cacheDetails && cachedHash);
        logging.debug(rid, 'New hash:', newHash);
        callback(null, status, newHash, slim);
      }
    });
  }).catch((err) => {
    callback(err, -1, null, false);
  });
}

/**
 * Get avatar image for a user
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param overlay - Whether to include helm overlay
 * @param size - Avatar size in pixels
 * @param callback - Called with (error, status, imageBuffer, hash)
 */
export function getAvatar(
  rid: string,
  userId: string,
  overlay: boolean,
  size: number,
  callback: (err: Error | null, status: number, image: Buffer | null, hash: string | null) => void
): void {
  getImageHash(rid, userId, 'skin', (err, status, skinHash, slim) => {
    if (skinHash) {
      const facepath = path.join(config.directories.faces, skinHash + '.png');
      const helmpath = path.join(config.directories.helms, skinHash + '.png');
      let filepath = facepath;

      // Check if helm overlay exists and is requested
      fs.access(helmpath, (fsErr) => {
        if (overlay && !fsErr) {
          filepath = helmpath;
        }

        // Resize the image to requested size
        skins.resizeImg(filepath, size, (imgErr, image) => {
          if (imgErr) {
            callback(imgErr, -1, null, skinHash);
          } else {
            callback(err, err ? -1 : status, image, skinHash);
          }
        });
      });
    } else {
      // User has no skin
      callback(err, status, null, null);
    }
  });
}

/**
 * Get full skin image for a user
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param callback - Called with (error, hash, status, imageBuffer, isSlim)
 */
export function getSkin(
  rid: string,
  userId: string,
  callback: (
    err: Error | null,
    hash: string | null,
    status: number,
    image: Buffer | null,
    slim: boolean
  ) => void
): void {
  getImageHash(rid, userId, 'skin', (err, status, skinHash, slim) => {
    if (skinHash) {
      const skinpath = path.join(config.directories.skins, skinHash + '.png');

      fs.access(skinpath, (fsErr) => {
        if (!fsErr) {
          // Skin exists on disk
          logging.debug(rid, 'Skin already exists, not downloading');
          skins.openSkin(rid, skinpath, (skinErr, img) => {
            callback(skinErr || err, skinHash, status, img, slim);
          });
        } else {
          // Need to download skin
          networking.saveTexture(rid, skinHash, skinpath, (netErr, response, img) => {
            callback(netErr || err, skinHash, status, img, slim);
          });
        }
      });
    } else {
      callback(err, null, status, null, slim);
    }
  });
}

/**
 * Helper to generate render type string for filenames
 * 
 * @param overlay - Whether overlay is enabled
 * @param body - Whether it's a body render
 * @returns Type string like 'body', 'bodyhelm', 'head', 'headhelm'
 */
function getType(overlay: boolean, body: boolean): string {
  const text = body ? 'body' : 'head';
  return overlay ? text + 'helm' : text;
}

/**
 * Get 3D render of a user's skin
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param scale - Render scale factor
 * @param overlay - Whether to include overlay layers
 * @param body - True for full body, false for head only
 * @param callback - Called with (error, status, hash, imageBuffer)
 */
export function getRender(
  rid: string,
  userId: string,
  scale: number,
  overlay: boolean,
  body: boolean,
  callback: (err: Error | null, status: number, hash: string | null, image: Buffer | null) => void
): void {
  getSkin(rid, userId, (err, skinHash, status, img, slim) => {
    if (!skinHash) {
      callback(err, status, skinHash, null);
      return;
    }

    // Build render filename with all parameters
    const renderFilename = [
      skinHash,
      scale,
      getType(overlay, body),
      slim ? 's' : 't',
    ].join('-') + '.png';
    
    const renderpath = path.join(config.directories.renders, renderFilename);

    // Check if render already exists
    fs.access(renderpath, (fsErr) => {
      if (!fsErr) {
        // Render exists - load from disk
        renders.openRender(rid, renderpath, (renderErr, renderedImg) => {
          callback(renderErr, 1, skinHash, renderedImg);
        });
        return;
      }

      // Need to create render
      if (!img) {
        callback(err, 0, skinHash, null);
        return;
      }

      // Check for special Alex UUID
      const isAlex = slim || userId.toLowerCase() === 'mhf_alex';

      renders.drawModel(rid, img, scale, overlay, body, isAlex, (drawErr, drawnImg) => {
        if (drawErr) {
          callback(drawErr, -1, skinHash, null);
        } else if (!drawnImg) {
          callback(null, 0, skinHash, null);
        } else {
          // Save render to disk
          fs.writeFile(renderpath, drawnImg, 'binary', (writeErr) => {
            callback(writeErr, status, skinHash, drawnImg);
          });
        }
      });
    });
  });
}

/**
 * Get cape image for a user
 * 
 * @param rid - Request ID for logging
 * @param userId - Minecraft UUID
 * @param callback - Called with (error, hash, status, imageBuffer)
 */
export function getCape(
  rid: string,
  userId: string,
  callback: (err: Error | null, hash: string | null, status: number, image: Buffer | null) => void
): void {
  getImageHash(rid, userId, 'cape', (err, status, capeHash) => {
    if (!capeHash) {
      callback(err, null, status, null);
      return;
    }

    const capepath = path.join(config.directories.capes, capeHash + '.png');

    fs.access(capepath, (fsErr) => {
      if (!fsErr) {
        // Cape exists on disk
        logging.debug(rid, 'Cape already exists, not downloading');
        skins.openSkin(rid, capepath, (skinErr, img) => {
          callback(skinErr || err, capeHash, status, img);
        });
      } else {
        // Need to download cape
        networking.saveTexture(rid, capeHash, capepath, (netErr, response, img) => {
          if (response && response.statusCode === 404) {
            callback(netErr, capeHash, status, null);
          } else {
            callback(netErr, capeHash, status, img);
          }
        });
      }
    });
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  id_valid: idValid,
  get_image_hash: getImageHash,
  get_avatar: getAvatar,
  get_skin: getSkin,
  get_render: getRender,
  get_cape: getCape,
  stoplog,
};
