/**
 * @fileoverview 3D Skin Rendering Module
 * 
 * Renders isometric 3D views of Minecraft player skins using canvas.
 * Based on the work of Confuser's serverless-mc-skin-viewer with
 * updates for Minecraft 1.8+ skin formats.
 * 
 * Features:
 * - Head-only or full body renders
 * - Support for overlay/helm layers
 * - Legacy (32x64) and modern (64x64) skin formats
 * - Slim (Alex) and classic (Steve) arm widths
 * 
 * @see https://github.com/confuser/serverless-mc-skin-viewer
 */

import logging from './logging';
import * as fs from 'fs';
import * as cvs from 'canvas';

// ============================================================================
// Constants
// ============================================================================

/**
 * Skew factors for isometric perspective
 * These create the 3D appearance of the rendered model
 */
const SKEW_A = 26 / 45;      // ~0.577 - Primary skew angle
const SKEW_B = SKEW_A * 2;   // ~1.155 - Secondary skew angle

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove transparency from a canvas by setting all alpha values to 255
 * 
 * This is used to ensure base layers are fully opaque before
 * compositing overlay layers on top.
 * 
 * @param canvas - Canvas to modify
 * @returns The same canvas with transparency removed
 */
function removeTransparency(canvas: cvs.Canvas): cvs.Canvas {
  const ctx = canvas.getContext('2d');
  const imagedata = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imagedata.data;

  // Image data is [r,g,b,a, r,g,b,a, ...]
  // Set every alpha value (index 3, 7, 11, ...) to 255
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 255;
  }

  ctx.putImageData(imagedata, 0, 0);
  return canvas;
}

/**
 * Check if a canvas has any pixels that are not fully opaque
 * 
 * Used to determine if overlay layers should be rendered.
 * 
 * @param canvas - Canvas to check
 * @returns True if any pixel has alpha < 255
 */
function hasTransparency(canvas: cvs.Canvas): boolean {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  // Check every alpha value
  for (let i = 3; i < imageData.length; i += 4) {
    if (imageData[i] < 255) {
      return true;
    }
  }

  return false;
}

/**
 * Resize a canvas by a scale factor
 * 
 * @param src - Source canvas
 * @param scale - Scale multiplier
 * @returns New canvas with scaled dimensions
 */
function resize(src: cvs.Canvas, scale: number): cvs.Canvas {
  const dst = cvs.createCanvas(scale * src.width, scale * src.height);
  const context = dst.getContext('2d');

  // Use 'fast' pattern quality to avoid anti-aliasing (keeps pixelated look)
  context.patternQuality = 'fast';
  context.drawImage(src, 0, 0, src.width * scale, src.height * scale);

  return dst;
}

/**
 * Extract a rectangular region from a canvas and optionally scale it
 * 
 * @param src - Source canvas (skin image)
 * @param x - X coordinate of region start
 * @param y - Y coordinate of region start
 * @param width - Width of region to extract
 * @param height - Height of region to extract
 * @param scale - Scale factor for output
 * @returns New canvas with the extracted and scaled region
 */
function getPart(
  src: cvs.Canvas | cvs.Image,
  x: number,
  y: number,
  width: number,
  height: number,
  scale: number
): cvs.Canvas {
  const dst = cvs.createCanvas(scale * width, scale * height);
  const context = dst.getContext('2d');

  context.patternQuality = 'fast';
  context.drawImage(src, x, y, width, height, 0, 0, width * scale, height * scale);

  return dst;
}

/**
 * Flip a canvas horizontally
 * 
 * Used to mirror arm/leg textures for the opposite side on legacy skins.
 * 
 * @param src - Source canvas
 * @returns New canvas with horizontally flipped content
 */
function flip(src: cvs.Canvas): cvs.Canvas {
  const dst = cvs.createCanvas(src.width, src.height);
  const context = dst.getContext('2d');

  context.scale(-1, 1);
  context.drawImage(src, -src.width, 0);

  return dst;
}

// ============================================================================
// Main Render Function
// ============================================================================

/**
 * Render a 3D isometric view of a Minecraft player skin
 * 
 * Creates an isometric projection showing the head and optionally the body.
 * Supports both legacy (32px height) and modern (64px height) skin formats,
 * as well as slim (Alex) and classic (Steve) arm widths.
 * 
 * @param rid - Request ID for logging
 * @param img - Skin image buffer (PNG format)
 * @param scale - Output scale factor (1-10 typically)
 * @param overlay - Whether to render the overlay/helm layers
 * @param isBody - True for full body, false for head only
 * @param slim - True for slim (3px wide) arms, false for classic (4px wide)
 * @param callback - Called with error and rendered image buffer
 */
export function drawModel(
  rid: string,
  img: Buffer,
  scale: number,
  overlay: boolean,
  isBody: boolean,
  slim: boolean,
  callback: (err: Error | null, buffer: Buffer | null) => void
): void {
  // Create output canvas with appropriate dimensions
  const canvas = cvs.createCanvas(
    scale * 20,
    scale * (isBody ? 45.1 : 18.5)
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = canvas.getContext('2d') as any;

  // Load the skin image
  cvs.loadImage(img).then((skin) => {
    // Detect legacy skin format (32px height vs 64px)
    const oldSkin = skin.height === 32;
    
    // Arm width: 3px for slim (Alex), 4px for classic (Steve)
    const armWidth = slim ? 3 : 4;

    // ========================================================================
    // Extract skin parts
    // ========================================================================

    // Head parts
    const headTop = resize(removeTransparency(getPart(skin, 8, 0, 8, 8, 1)), scale);
    const headFront = resize(removeTransparency(getPart(skin, 8, 8, 8, 8, 1)), scale);
    const headRight = resize(removeTransparency(getPart(skin, 0, 8, 8, 8, 1)), scale);

    // Right arm parts
    const armRightTop = resize(removeTransparency(getPart(skin, 44, 16, armWidth, 4, 1)), scale);
    const armRightFront = resize(removeTransparency(getPart(skin, 44, 20, armWidth, 12, 1)), scale);
    const armRightSide = resize(removeTransparency(getPart(skin, 40, 20, 4, 12, 1)), scale);

    // Left arm parts (mirrored for legacy skins)
    const armLeftTop = oldSkin
      ? flip(armRightTop)
      : resize(removeTransparency(getPart(skin, 36, 48, armWidth, 4, 1)), scale);
    const armLeftFront = oldSkin
      ? flip(armRightFront)
      : resize(removeTransparency(getPart(skin, 36, 52, armWidth, 12, 1)), scale);

    // Leg parts
    const legRightFront = resize(removeTransparency(getPart(skin, 4, 20, 4, 12, 1)), scale);
    const legRightSide = resize(removeTransparency(getPart(skin, 0, 20, 4, 12, 1)), scale);
    const legLeftFront = oldSkin
      ? flip(legRightFront)
      : resize(removeTransparency(getPart(skin, 20, 52, 4, 12, 1)), scale);

    // Body front
    const bodyFront = resize(removeTransparency(getPart(skin, 20, 20, 8, 12, 1)), scale);

    // ========================================================================
    // Apply overlays if enabled
    // ========================================================================

    if (overlay) {
      // Check head overlay region for transparency
      if (hasTransparency(getPart(skin, 32, 0, 32, 32, 1))) {
        // Render head overlay (helm)
        headTop.getContext('2d').drawImage(getPart(skin, 40, 0, 8, 8, scale), 0, 0);
        headFront.getContext('2d').drawImage(getPart(skin, 40, 8, 8, 8, scale), 0, 0);
        headRight.getContext('2d').drawImage(getPart(skin, 32, 8, 8, 8, scale), 0, 0);
      }

      // Body/arm/leg overlays only exist in modern skins
      if (!oldSkin) {
        // Define overlay regions for checking
        const bodyRegion = getPart(skin, 16, 32, 32, 16, 1);
        const rightArmRegion = getPart(skin, 48, 48, 16, 16, 1);
        const leftArmRegion = getPart(skin, 40, 32, 16, 16, 1);
        const rightLegRegion = getPart(skin, 0, 32, 16, 16, 1);
        const leftLegRegion = getPart(skin, 0, 48, 16, 16, 1);

        // Apply body overlay
        if (hasTransparency(bodyRegion)) {
          bodyFront.getContext('2d').drawImage(getPart(skin, 20, 36, 8, 12, scale), 0, 0);
        }

        // Apply right arm overlay
        if (hasTransparency(rightArmRegion)) {
          armRightTop.getContext('2d').drawImage(getPart(skin, 44, 32, armWidth, 4, scale), 0, 0);
          armRightFront.getContext('2d').drawImage(getPart(skin, 44, 36, armWidth, 12, scale), 0, 0);
          armRightSide.getContext('2d').drawImage(getPart(skin, 40, 36, 4, 12, scale), 0, 0);
        }

        // Apply left arm overlay
        if (hasTransparency(leftArmRegion)) {
          armLeftTop.getContext('2d').drawImage(getPart(skin, 52, 48, armWidth, 4, scale), 0, 0);
          armLeftFront.getContext('2d').drawImage(getPart(skin, 52, 52, armWidth, 12, scale), 0, 0);
        }

        // Apply right leg overlay
        if (hasTransparency(rightLegRegion)) {
          legRightFront.getContext('2d').drawImage(getPart(skin, 4, 36, 4, 12, scale), 0, 0);
          legRightSide.getContext('2d').drawImage(getPart(skin, 0, 36, 4, 12, scale), 0, 0);
        }

        // Apply left leg overlay
        if (hasTransparency(leftLegRegion)) {
          legLeftFront.getContext('2d').drawImage(getPart(skin, 4, 52, 4, 12, scale), 0, 0);
        }
      }
    }

    // ========================================================================
    // Render the 3D model using isometric projection
    // ========================================================================

    // Positioning variables
    let x = 0;
    let y = 0;
    let z = 0;
    const zOffset = scale * 3;
    const xOffset = scale * 2;

    // Render body parts (if enabled)
    if (isBody) {
      // Pre-render front body parts onto separate canvas
      const front = cvs.createCanvas(scale * 16, scale * 24);
      const frontc = front.getContext('2d');
      frontc.patternQuality = 'fast';

      // Position body parts on front canvas
      frontc.drawImage(armRightFront, (4 - armWidth) * scale, 0, armWidth * scale, 12 * scale);
      frontc.drawImage(armLeftFront, 12 * scale, 0, armWidth * scale, 12 * scale);
      frontc.drawImage(bodyFront, 4 * scale, 0, 8 * scale, 12 * scale);
      frontc.drawImage(legRightFront, 4 * scale, 12 * scale, 4 * scale, 12 * scale);
      frontc.drawImage(legLeftFront, 8 * scale, 12 * scale, 4 * scale, 12 * scale);

      // Draw arm tops (isometric top view)
      x = xOffset + scale * 2;
      y = scale * -armWidth;
      z = zOffset + scale * 8;
      ctx.setTransform(1, -SKEW_A, 1, SKEW_A, 0, 0);
      ctx.drawImage(armRightTop, y - z - 0.5, x + z, armRightTop.width + 1, armRightTop.height + 1);

      y = scale * 8;
      ctx.drawImage(armLeftTop, y - z, x + z, armLeftTop.width, armLeftTop.height + 1);

      // Draw right side of body (leg and arm)
      ctx.setTransform(1, SKEW_A, 0, SKEW_B, 0, 0);
      x = xOffset + scale * 2;
      y = 0;
      z = zOffset + scale * 20;
      ctx.drawImage(legRightSide, x + y, z - y, legRightSide.width, legRightSide.height);

      x = xOffset + scale * 2;
      y = scale * -armWidth;
      z = zOffset + scale * 8;
      ctx.drawImage(armRightSide, x + y, z - y - 0.5, armRightSide.width, armRightSide.height + 1);

      // Draw front of body
      z = zOffset + scale * 12;
      y = 0;
      ctx.setTransform(1, -SKEW_A, 0, SKEW_B, 0, SKEW_A);
      ctx.drawImage(front, y + x, x + z - 0.5, front.width, front.height);
    }

    // ========================================================================
    // Render head (always rendered)
    // ========================================================================

    // Head top (isometric top view)
    x = xOffset;
    y = -0.5;
    z = zOffset;
    ctx.setTransform(1, -SKEW_A, 1, SKEW_A, 0, 0);
    ctx.drawImage(headTop, y - z, x + z, headTop.width, headTop.height + 1);

    // Head front
    x = xOffset + 8 * scale;
    y = 0;
    z = zOffset - 0.5;
    ctx.setTransform(1, -SKEW_A, 0, SKEW_B, 0, SKEW_A);
    ctx.drawImage(headFront, y + x, x + z, headFront.width, headFront.height);

    // Head right side
    x = xOffset;
    y = 0;
    z = zOffset;
    ctx.setTransform(1, SKEW_A, 0, SKEW_B, 0, 0);
    ctx.drawImage(headRight, x + y, z - y - 0.5, headRight.width + 0.5, headRight.height + 1);

    // ========================================================================
    // Output the rendered image
    // ========================================================================

    canvas.toBuffer((err, buf) => {
      if (err) {
        logging.error(rid, 'Error creating buffer:', err);
      }
      callback(err, buf);
    });
  }).catch((err) => {
    logging.error(rid, 'Error loading skin image:', err);
    callback(err as Error, null);
  });
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read a previously rendered image from disk
 * 
 * @param rid - Request ID for logging
 * @param renderpath - Path to the render file
 * @param callback - Called with error and image buffer
 */
export function openRender(
  rid: string,
  renderpath: string,
  callback: (err: NodeJS.ErrnoException | null, buffer: Buffer | null) => void
): void {
  fs.readFile(renderpath, (err, buffer) => {
    callback(err, err ? null : buffer);
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  drawModel,
  openRender,
};
