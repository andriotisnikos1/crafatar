/**
 * @fileoverview Render Route Handler
 * 
 * Handles requests for 3D rendered Minecraft skin images.
 * Supports head-only or full body renders with various options.
 * 
 * URL Format: /renders/{type}/{uuid}[.png]
 * 
 * Path Parameters:
 * - type: 'head' or 'body'
 * 
 * Query Parameters:
 * - scale: Render scale factor (min_scale to max_scale)
 * - overlay/helm: Include overlay layers (hat, jacket, etc.)
 * - default: Fallback for missing skins
 */

import logging from '../lib/logging';
import * as helpers from '../lib/helpers';
import config from '../config';
import cache from '../lib/cache';
import { CrafatarRequest, ResponseResult } from '../lib/response';
import {
  handleRenderDefault,
  validateUuid,
  validationError,
  pathError,
} from '../lib/route-utils';

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Handle GET request for 3D render images
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
export function rendersRoute(
  req: CrafatarRequest,
  callback: (result: ResponseResult) => void
): void {
  // Validate path length
  if (req.url.path_list.length > 3) {
    callback(pathError());
    return;
  }

  // Parse render type
  const rawType = req.url.path_list[1] || '';
  if (rawType !== 'body' && rawType !== 'head') {
    callback(validationError('Invalid Render Type'));
    return;
  }

  // Parse and validate UUID
  const userId = validateUuid(req.url.path_list[2] || '');
  if (!userId) {
    callback(validationError('Invalid UUID'));
    return;
  }

  const rid = req.id;
  const body = rawType === 'body';
  const defaultVal = req.url.searchParams.get('default');
  const scale = parseInt(req.url.searchParams.get('scale') || '', 10) || config.renders.default_scale;
  const overlay = req.url.searchParams.has('overlay') || req.url.searchParams.has('helm');

  // Validate scale
  if (scale < config.renders.min_scale || scale > config.renders.max_scale) {
    callback(validationError('Invalid Scale'));
    return;
  }

  // Fetch and return render
  try {
    helpers.getRender(rid, userId, scale, overlay, body, (err, status, hash, image) => {
      // Clear cache on file not found
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(rid, userId);
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
        logging.debug(rid, 'Image not found, using default.');
        handleRenderDefault({
          rid,
          userId,
          defaultVal,
          req,
          err,
          status,
          callback,
          scale,
          overlay,
          body,
        });
      }
    });
  } catch (e) {
    handleRenderDefault({
      rid,
      userId,
      defaultVal,
      req,
      err: e as Error,
      status: -1,
      callback,
      scale,
      overlay,
      body,
    });
  }
}

export default rendersRoute;
