/**
 * @fileoverview Cape Route Handler
 * 
 * Handles requests for Minecraft cape images.
 * Capes are optional accessories that not all players have.
 * 
 * URL Format: /capes/{uuid}[.png]
 * 
 * Query Parameters:
 * - default: Fallback URL for players without capes
 */

import * as helpers from '../lib/helpers';
import cache from '../lib/cache';
import { CrafatarRequest, ResponseResult } from '../lib/response';
import { validateUuid, validationError, pathError } from '../lib/route-utils';

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Handle GET request for cape images
 * 
 * Unlike skins, there's no built-in default cape. If a user doesn't have
 * a cape and no default URL is provided, a 404 is returned.
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
export function capesRoute(
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

  // Fetch and return cape
  try {
    helpers.getCape(rid, userId, (err, hash, status, image) => {
      // Clear cache on file not found
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(req.id, userId);
      }

      callback({
        status,
        body: image || undefined,
        type: image ? 'image/png' : undefined,
        redirect: image ? undefined : (defaultVal || undefined),
        hash: hash || undefined,
        err,
      });
    });
  } catch (e) {
    callback({ status: -1, err: e as Error });
  }
}

export default capesRoute;
