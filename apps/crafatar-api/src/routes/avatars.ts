/**
 * @fileoverview Avatar Route Handler
 * 
 * Handles requests for Minecraft avatar images (face with optional helm overlay).
 * Supports various modifiers including size, overlay, and default fallback.
 * 
 * URL Format: /avatars/{uuid}[.png]
 * 
 * Query Parameters:
 * - size: Avatar size in pixels (min_size to max_size)
 * - overlay/helm: Include helm overlay layer
 * - default: Fallback for missing skins (uuid, url, mhf_steve, mhf_alex)
 */

import * as helpers from '../lib/helpers';
import config from '../config';
import skins from '../lib/skins';
import cache from '../lib/cache';
import * as path from 'path';
import { CrafatarRequest, ResponseResult } from '../lib/response';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle default/fallback skin response
 * 
 * When a user has no custom skin, this function handles the fallback:
 * - mhf_steve/mhf_alex: Return built-in default skin
 * - UUID: Redirect to that user's avatar
 * - URL: Redirect to external image
 * 
 * @param imgStatus - Image status code for response
 * @param userId - Original user's UUID
 * @param size - Requested avatar size
 * @param defaultVal - Default parameter value
 * @param req - Original request object
 * @param err - Any error that occurred
 * @param callback - Response callback
 */
function handleDefault(
  imgStatus: number,
  userId: string,
  size: number,
  defaultVal: string | null,
  req: CrafatarRequest,
  err: Error | null,
  callback: (result: ResponseResult) => void
): void {
  // Use UUID-based default if none specified
  const def = defaultVal || skins.defaultSkin(userId);
  const defname = def.toLowerCase();

  // Check if it's a built-in default (steve/alex)
  if (
    defname !== 'steve' &&
    defname !== 'mhf_steve' &&
    defname !== 'alex' &&
    defname !== 'mhf_alex'
  ) {
    // Check if default is a valid UUID (redirect to that user's avatar)
    if (helpers.idValid(def)) {
      // Build redirect URL with new UUID
      req.url.searchParams.delete('default');
      req.url.path_list[1] = def;
      req.url.pathname = req.url.path_list.join('/');
      const newUrl = req.url.toString();

      callback({
        status: imgStatus,
        redirect: newUrl,
        err: err,
      });
    } else {
      // Assume it's an external URL - redirect there
      callback({
        status: imgStatus,
        redirect: def,
        err: err,
      });
    }
    return;
  }

  // Handle built-in steve/alex skins
  let normalizedDef = defname;
  if (!normalizedDef.startsWith('mhf_')) {
    normalizedDef = 'mhf_' + normalizedDef;
  }

  // Resize and return the default skin image
  const defaultPath = path.join(__dirname, '..', 'public', 'images', normalizedDef + '.png');
  
  skins.resizeImg(defaultPath, size, (resizeErr, image) => {
    callback({
      status: imgStatus,
      body: image || undefined,
      type: 'image/png',
      hash: normalizedDef,
      err: resizeErr || err,
    });
  });
}

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Handle GET request for avatar images
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
export function avatarsRoute(
  req: CrafatarRequest,
  callback: (result: ResponseResult) => void
): void {
  // Extract UUID from path (remove .png extension if present)
  let userId = (req.url.path_list[1] || '').split('.')[0];
  
  // Parse query parameters
  const size = parseInt(req.url.searchParams.get('size') || '', 10) || config.avatars.default_size;
  const defaultVal = req.url.searchParams.get('default');
  const overlay = req.url.searchParams.has('overlay') || req.url.searchParams.has('helm');

  // ========================================================================
  // Validate request
  // ========================================================================

  // Check for extra path segments
  if (req.url.path_list.length > 2) {
    callback({
      status: -2,
      body: 'Invalid Path',
      code: 404,
    });
    return;
  }

  // Strip dashes from UUID
  userId = userId.replace(/-/g, '');

  // Validate size parameter
  if (size < config.avatars.min_size || size > config.avatars.max_size) {
    callback({
      status: -2,
      body: 'Invalid Size',
    });
    return;
  }

  // Validate UUID format
  if (!helpers.idValid(userId)) {
    callback({
      status: -2,
      body: 'Invalid UUID',
    });
    return;
  }

  // ========================================================================
  // Fetch and return avatar
  // ========================================================================

  try {
    helpers.getAvatar(req.id, userId, overlay, size, (err, status, image, hash) => {
      // Handle file not found errors by clearing cache
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(req.id, userId);
      }

      if (image) {
        // Return the avatar image
        callback({
          status: status,
          body: image,
          type: 'image/png',
          err: err,
          hash: hash || undefined,
        });
      } else {
        // No custom skin - return default
        handleDefault(status, userId, size, defaultVal, req, err, callback);
      }
    });
  } catch (e) {
    // Handle unexpected errors
    handleDefault(-1, userId, size, defaultVal, req, e as Error, callback);
  }
}

export default avatarsRoute;
