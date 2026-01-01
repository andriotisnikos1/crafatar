/**
 * @fileoverview Skin Route Handler
 * 
 * Handles requests for full Minecraft skin images.
 * Supports default fallback parameter for missing skins.
 * 
 * URL Format: /skins/{uuid}[.png]
 * 
 * Query Parameters:
 * - default: Fallback for missing skins (uuid, url, mhf_steve, mhf_alex)
 */

import * as helpers from '../lib/helpers';
import skins from '../lib/skins';
import cache from '../lib/cache';
import * as path from 'path';
import sharp from 'sharp';
import { CrafatarRequest, ResponseResult } from '../lib/response';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle default/fallback skin response
 * 
 * When a user has no custom skin, this function handles the fallback:
 * - mhf_steve/mhf_alex: Return built-in default skin
 * - UUID: Redirect to that user's skin
 * - URL: Redirect to external image
 * 
 * @param imgStatus - Image status code for response
 * @param userId - Original user's UUID
 * @param defaultVal - Default parameter value
 * @param req - Original request object
 * @param err - Any error that occurred
 * @param callback - Response callback
 */
async function handleDefault(
  imgStatus: number,
  userId: string,
  defaultVal: string | null,
  req: CrafatarRequest,
  err: Error | null,
  callback: (result: ResponseResult) => void
): Promise<void> {
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
    // Check if default is a valid UUID
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
      // Assume it's an external URL
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

  // Load and return the full default skin using sharp
  const defaultPath = path.join(__dirname, '..', 'public', 'images', normalizedDef + '_skin.png');

  try {
    const buffer = await sharp(defaultPath).png().toBuffer();
    callback({
      status: imgStatus,
      body: buffer,
      type: 'image/png',
      hash: normalizedDef,
      err: err,
    });
  } catch (sharpErr) {
    callback({
      status: -1,
      err: sharpErr as Error || err,
    });
  }
}

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Handle GET request for skin images
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
export function skinsRoute(
  req: CrafatarRequest,
  callback: (result: ResponseResult) => void
): void {
  // Extract UUID from path
  let userId = (req.url.path_list[1] || '').split('.')[0];
  const defaultVal = req.url.searchParams.get('default');
  const rid = req.id;

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

  // Validate UUID format
  if (!helpers.idValid(userId)) {
    callback({
      status: -2,
      body: 'Invalid UUID',
    });
    return;
  }

  // ========================================================================
  // Fetch and return skin
  // ========================================================================

  try {
    helpers.getSkin(rid, userId, (err, hash, status, image, slim) => {
      // Handle file not found errors
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(req.id, userId);
      }

      if (image) {
        // Return the skin image
        callback({
          status: status,
          body: image,
          type: 'image/png',
          hash: hash || undefined,
          err: err,
        });
      } else {
        // No custom skin - return default
        handleDefault(2, userId, defaultVal, req, err, callback);
      }
    });
  } catch (e) {
    handleDefault(-1, userId, defaultVal, req, e as Error, callback);
  }
}

export default skinsRoute;
