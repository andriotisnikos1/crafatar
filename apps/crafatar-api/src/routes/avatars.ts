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
import cache from '../lib/cache';
import { CrafatarRequest, ResponseResult } from '../lib/response';
import {
  handleAvatarDefault,
  validateUuid,
  validationError,
  pathError,
} from '../lib/route-utils';

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

  // Parse query parameters
  const size = parseInt(req.url.searchParams.get('size') || '', 10) || config.avatars.default_size;
  const defaultVal = req.url.searchParams.get('default');
  const overlay = req.url.searchParams.has('overlay') || req.url.searchParams.has('helm');

  // Validate size
  if (size < config.avatars.min_size || size > config.avatars.max_size) {
    callback(validationError('Invalid Size'));
    return;
  }

  // Fetch and return avatar
  try {
    helpers.getAvatar(req.id, userId, overlay, size, (err, status, image, hash) => {
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
        handleAvatarDefault({
          rid: req.id,
          userId,
          defaultVal,
          req,
          err,
          status,
          callback,
          size,
        });
      }
    });
  } catch (e) {
    handleAvatarDefault({
      rid: req.id,
      userId,
      defaultVal,
      req,
      err: e as Error,
      status: -1,
      callback,
      size,
    });
  }
}

export default avatarsRoute;
