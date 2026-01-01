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
  // Fetch and return cape
  // ========================================================================

  try {
    helpers.getCape(rid, userId, (err, hash, status, image) => {
      // Handle file not found errors
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(req.id, userId);
      }

      // Return result (with optional redirect if no cape)
      callback({
        status: status,
        body: image || undefined,
        type: image ? 'image/png' : undefined,
        redirect: image ? undefined : (defaultVal || undefined),
        hash: hash || undefined,
        err: err,
      });
    });
  } catch (e) {
    callback({
      status: -1,
      err: e as Error,
    });
  }
}

export default capesRoute;
