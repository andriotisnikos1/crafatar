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
import cache from '../lib/cache';
import { CrafatarRequest, ResponseResult } from '../lib/response';
import {
  handleSkinDefault,
  validateUuid,
  validationError,
  pathError,
} from '../lib/route-utils';

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
  // Validate path length
  if (req.url.path_list.length > 2) {
    callback(pathError());
    return;
  }

  // Parse and validate UUID
  const userId = validateUuid(req.url.path_list[1] || '');
  if (!userId) {
    callback(validationError('Invalid UUID'));
    return;
  }

  const defaultVal = req.url.searchParams.get('default');
  const rid = req.id;

  // Fetch and return skin
  try {
    helpers.getSkin(rid, userId, (err, hash, status, image, slim) => {
      // Clear cache on file not found
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(req.id, userId);
      }

      if (image) {
        callback({
          status,
          body: image,
          type: 'image/png',
          hash: hash || undefined,
          err,
        });
      } else {
        handleSkinDefault({
          rid,
          userId,
          defaultVal,
          req,
          err,
          status: 2,
          callback,
        });
      }
    });
  } catch (e) {
    handleSkinDefault({
      rid,
      userId,
      defaultVal,
      req,
      err: e as Error,
      status: -1,
      callback,
    });
  }
}

export default skinsRoute;
