/**
 * @fileoverview Shared Route Utilities
 * 
 * This module provides shared utilities for route handlers to eliminate
 * code duplication and reduce complexity. Contains:
 * - Default skin/fallback handling
 * - Request validation helpers
 * - Common response builders
 */

import * as helpers from './helpers';
import skins from './skins';
import renders from './renders';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { CrafatarRequest, ResponseResult } from './response';

// ============================================================================
// Constants
// ============================================================================

/** Built-in default skin names */
const BUILTIN_DEFAULTS = ['steve', 'mhf_steve', 'alex', 'mhf_alex'];

// ============================================================================
// Type Definitions
// ============================================================================

/** Options for handling default/fallback responses */
export interface DefaultHandlerOptions {
  /** Request ID for logging */
  rid: string;
  /** Original user's UUID */
  userId: string;
  /** Default parameter value from query string */
  defaultVal: string | null;
  /** Original request object */
  req: CrafatarRequest;
  /** Any error that occurred */
  err: Error | null;
  /** Image status code */
  status: number;
  /** Response callback */
  callback: (result: ResponseResult) => void;
}

/** Additional options for avatar defaults */
export interface AvatarDefaultOptions extends DefaultHandlerOptions {
  /** Requested avatar size */
  size: number;
}

/** Additional options for render defaults */
export interface RenderDefaultOptions extends DefaultHandlerOptions {
  /** Render scale factor */
  scale: number;
  /** Whether to include overlay */
  overlay: boolean;
  /** Whether it's a body render */
  body: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize default skin name to mhf_ prefix format
 */
function normalizeDefaultName(defname: string): string {
  return defname.startsWith('mhf_') ? defname : 'mhf_' + defname;
}

/**
 * Check if a default value is a built-in skin (steve/alex)
 */
function isBuiltinDefault(defname: string): boolean {
  return BUILTIN_DEFAULTS.includes(defname.toLowerCase());
}

/**
 * Handle redirect for non-builtin defaults (UUID or URL)
 */
function handleRedirect(
  def: string,
  req: CrafatarRequest,
  pathIndex: number,
  status: number,
  err: Error | null,
  callback: (result: ResponseResult) => void
): boolean {
  if (helpers.idValid(def)) {
    // Redirect to another user's resource
    req.url.searchParams.delete('default');
    req.url.path_list[pathIndex] = def;
    req.url.pathname = req.url.path_list.join('/');
    callback({ status, redirect: req.url.toString(), err });
    return true;
  }
  
  // Assume it's an external URL
  callback({ status, redirect: def, err });
  return true;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Handle default/fallback for avatar requests
 * 
 * Simplifies avatar default handling by:
 * - Determining the correct default (steve/alex based on UUID)
 * - Handling redirects for UUID/URL defaults
 * - Loading and resizing built-in default images
 */
export function handleAvatarDefault(options: AvatarDefaultOptions): void {
  const { userId, defaultVal, req, err, status, callback, size } = options;
  const def = defaultVal || skins.defaultSkin(userId);
  const defname = def.toLowerCase();

  if (!isBuiltinDefault(defname)) {
    handleRedirect(def, req, 1, status, err, callback);
    return;
  }

  const normalizedDef = normalizeDefaultName(defname);
  const defaultPath = path.join(__dirname, 'public', 'images', normalizedDef + '.png');
  
  skins.resizeImg(defaultPath, size, (resizeErr, image) => {
    callback({
      status,
      body: image || undefined,
      type: 'image/png',
      hash: normalizedDef,
      err: resizeErr || err,
    });
  });
}

/**
 * Handle default/fallback for skin requests
 * 
 * Simplifies skin default handling by:
 * - Determining the correct default (steve/alex based on UUID)
 * - Handling redirects for UUID/URL defaults
 * - Loading built-in default skin images
 */
export async function handleSkinDefault(options: DefaultHandlerOptions): Promise<void> {
  const { userId, defaultVal, req, err, status, callback } = options;
  const def = defaultVal || skins.defaultSkin(userId);
  const defname = def.toLowerCase();

  if (!isBuiltinDefault(defname)) {
    handleRedirect(def, req, 1, status, err, callback);
    return;
  }

  const normalizedDef = normalizeDefaultName(defname);
  const defaultPath = path.join(__dirname, 'public', 'images', normalizedDef + '_skin.png');

  try {
    const buffer = await sharp(defaultPath).png().toBuffer();
    callback({
      status,
      body: buffer,
      type: 'image/png',
      hash: normalizedDef,
      err,
    });
  } catch (sharpErr) {
    callback({ status: -1, err: (sharpErr as Error) || err });
  }
}

/**
 * Handle default/fallback for render requests
 * 
 * Simplifies render default handling by:
 * - Determining the correct default (steve/alex based on UUID)
 * - Handling redirects for UUID/URL defaults
 * - Rendering built-in default skins
 */
export function handleRenderDefault(options: RenderDefaultOptions): void {
  const { rid, userId, defaultVal, req, err, status, callback, scale, overlay, body } = options;
  const def = defaultVal || skins.defaultSkin(userId);
  const defname = def.toLowerCase();

  if (!isBuiltinDefault(defname)) {
    handleRedirect(def, req, 2, status, err, callback);
    return;
  }

  const normalizedDef = normalizeDefaultName(defname);
  const defaultPath = path.join(__dirname, 'public', 'images', normalizedDef + '_skin.png');

  fs.readFile(defaultPath, (fsErr, buf) => {
    if (fsErr || !buf) {
      callback({ status: -1, err: fsErr || err });
      return;
    }

    renders.drawModel(rid, buf, scale, overlay, body, normalizedDef === 'mhf_alex', (renderErr, defImg) => {
      callback({
        status,
        body: defImg || undefined,
        type: 'image/png',
        hash: normalizedDef,
        err: renderErr || err,
      });
    });
  });
}

/**
 * Validate and normalize a UUID from request path
 * 
 * @returns Normalized UUID or null if invalid
 */
export function validateUuid(rawId: string): string | null {
  const userId = rawId.split('.')[0].replace(/-/g, '');
  return helpers.idValid(userId) ? userId : null;
}

/**
 * Create a validation error response
 */
export function validationError(message: string, code = 422): ResponseResult {
  return { status: -2, body: message, code };
}

/**
 * Create a path validation error response
 */
export function pathError(): ResponseResult {
  return { status: -2, body: 'Invalid Path', code: 404 };
}
