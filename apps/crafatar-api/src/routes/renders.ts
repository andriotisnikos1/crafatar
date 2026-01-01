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
import renders from '../lib/renders';
import config from '../config';
import cache from '../lib/cache';
import skins from '../lib/skins';
import * as path from 'path';
import * as fs from 'fs';
import { CrafatarRequest, ResponseResult } from '../lib/response';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle default/fallback skin response for renders
 * 
 * When a user has no custom skin, this function handles the fallback:
 * - mhf_steve/mhf_alex: Render the built-in default skin
 * - UUID: Redirect to that user's render
 * - URL: Redirect to external image
 * 
 * @param rid - Request ID for logging
 * @param scale - Render scale factor
 * @param overlay - Whether to include overlay
 * @param body - Whether it's a body render
 * @param imgStatus - Image status code
 * @param userId - Original user's UUID
 * @param size - Unused (kept for signature compatibility)
 * @param defaultVal - Default parameter value
 * @param req - Original request object
 * @param err - Any error that occurred
 * @param callback - Response callback
 */
function handleDefault(
  rid: string,
  scale: number,
  overlay: boolean,
  body: boolean,
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
    // Check if default is a valid UUID
    if (helpers.idValid(def)) {
      // Build redirect URL with new UUID
      req.url.searchParams.delete('default');
      req.url.path_list[2] = def;
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

  // Load default skin and render it
  const defaultPath = path.join(__dirname, '..', 'public', 'images', normalizedDef + '_skin.png');

  fs.readFile(defaultPath, (fsErr, buf) => {
    // Render the default skin (Alex model for mhf_alex, Steve for others)
    renders.drawModel(
      rid,
      buf,
      scale,
      overlay,
      body,
      normalizedDef === 'mhf_alex',
      (renderErr, defImg) => {
        callback({
          status: imgStatus,
          body: defImg || undefined,
          type: 'image/png',
          hash: normalizedDef,
          err: renderErr || fsErr || err,
        });
      }
    );
  });
}

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
  // Extract render type from path
  const rawType = req.url.path_list[1] || '';
  const rid = req.id;
  const body = rawType === 'body';
  
  // Extract UUID from path
  let userId = (req.url.path_list[2] || '').split('.')[0];
  
  // Parse query parameters
  const defaultVal = req.url.searchParams.get('default');
  const scale = parseInt(req.url.searchParams.get('scale') || '', 10) || config.renders.default_scale;
  const overlay = req.url.searchParams.has('overlay') || req.url.searchParams.has('helm');

  // ========================================================================
  // Validate request
  // ========================================================================

  // Check for extra path segments
  if (req.url.path_list.length > 3) {
    callback({
      status: -2,
      body: 'Invalid Path',
      code: 404,
    });
    return;
  }

  // Validate render type
  if (rawType !== 'body' && rawType !== 'head') {
    callback({
      status: -2,
      body: 'Invalid Render Type',
    });
    return;
  }

  // Strip dashes from UUID
  userId = userId.replace(/-/g, '');

  // Validate scale parameter
  if (scale < config.renders.min_scale || scale > config.renders.max_scale) {
    callback({
      status: -2,
      body: 'Invalid Scale',
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
  // Fetch and return render
  // ========================================================================

  try {
    helpers.getRender(rid, userId, scale, overlay, body, (err, status, hash, image) => {
      // Handle file not found errors
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.removeHash(rid, userId);
      }

      if (image) {
        // Return the rendered image
        callback({
          status: status,
          body: image,
          type: 'image/png',
          hash: hash || undefined,
          err: err,
        });
      } else {
        // No custom skin - render default
        logging.debug(rid, 'Image not found, using default.');
        handleDefault(rid, scale, overlay, body, status, userId, scale, defaultVal, req, err, callback);
      }
    });
  } catch (e) {
    handleDefault(rid, scale, overlay, body, -1, userId, scale, defaultVal, req, e as Error, callback);
  }
}

export default rendersRoute;
