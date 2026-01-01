/**
 * @fileoverview Skin Image Processing Module
 * 
 * Handles all skin-related image operations including:
 * - Extracting face from full skin images
 * - Extracting and compositing helm overlays
 * - Resizing images for different avatar sizes
 * - Determining default skin type (Steve/Alex) from UUID
 * - Reading and writing skin image files
 * 
 * Image coordinates are based on Minecraft's skin format:
 * - 64x64 (modern) or 64x32 (legacy) pixel skins
 * - Face located at pixels (8,8) to (15,15)
 * - Helm overlay at pixels (40,8) to (47,15) for head region
 * 
 * Uses sharp for image processing (fast, modern library)
 */

import logging from './logging';
import sharp from 'sharp';
import * as fs from 'fs';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Callback function for operations that return an error or success
 */
type ErrorCallback = (err: Error | null) => void;

/**
 * Callback function for operations that return an image buffer
 */
type ImageCallback = (err: Error | null, image: Buffer | null) => void;

// ============================================================================
// Face Extraction
// ============================================================================

/**
 * Extract the face region from a Minecraft skin image
 * 
 * The face is located at pixels (8,8) to (15,15) in the skin texture.
 * The resulting image is 8x8 pixels.
 * 
 * @param buffer - Raw skin image buffer (PNG format)
 * @param outname - Output file path for the extracted face
 * @param callback - Called with error or null on success
 */
export function extractFace(
  buffer: Buffer,
  outname: string,
  callback: ErrorCallback
): void {
  sharp(buffer)
    .extract({ left: 8, top: 8, width: 8, height: 8 })  // Face region
    .removeAlpha()  // Remove transparency
    .toFile(outname)
    .then(() => callback(null))
    .catch((err) => callback(err));
}

/**
 * Extract helm overlay and composite it onto the face
 * 
 * The helm overlay is a semi-transparent layer that sits on top of the face.
 * This function:
 * 1. Checks if the helm area has any transparency (non-opaque pixels)
 * 2. If fully opaque, skips compositing (old skins without proper helm)
 * 3. Otherwise, composites the helm layer onto the face
 * 
 * @param rid - Request ID for logging
 * @param facefile - Path to the previously extracted face image
 * @param buffer - Raw skin image buffer
 * @param outname - Output file path for the face+helm composite
 * @param callback - Called with error or null on success
 */
export async function extractHelm(
  rid: string,
  facefile: string,
  buffer: Buffer,
  outname: string,
  callback: ErrorCallback
): Promise<void> {
  try {
    // Get the skin image metadata and raw pixels
    const skinImage = sharp(buffer);
    const { width, height, channels } = await skinImage.metadata();
    
    // Extract the helm overlay area (32,0 to 63,31) to check transparency
    const helmAreaBuffer = await skinImage
      .clone()
      .extract({ left: 32, top: 0, width: 32, height: 32 })
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Check if helm area has transparency
    let isOpaque = true;
    for (let i = 3; i < helmAreaBuffer.length; i += 4) {
      if (helmAreaBuffer[i] < 255) {
        isOpaque = false;
        break;
      }
    }

    if (isOpaque) {
      logging.debug(rid, 'Skin is not transparent, skipping helm!');
      callback(null);
      return;
    }

    // Extract the helm face region (40,8 to 47,15)
    const helmBuffer = await sharp(buffer)
      .extract({ left: 40, top: 8, width: 8, height: 8 })
      .toBuffer();

    // Load the original face
    const faceBuffer = await sharp(facefile).toBuffer();

    // Compare face with composited version
    const faceHelmBuffer = await sharp(faceBuffer)
      .composite([{ input: helmBuffer, blend: 'over' }])
      .toBuffer();

    // Only save if helm actually changes the appearance
    if (!faceBuffer.equals(faceHelmBuffer)) {
      await sharp(faceHelmBuffer).toFile(outname);
      callback(null);
    } else {
      logging.debug(rid, 'Helm image == face image, not storing!');
      callback(null);
    }
  } catch (err) {
    callback(err as Error);
  }
}

// ============================================================================
// Image Resizing
// ============================================================================

/**
 * Resize an image to a square of specified size
 * 
 * Uses nearest-neighbor interpolation to preserve the pixelated
 * appearance of Minecraft skins (no blurring).
 * 
 * @param inname - Input file path
 * @param size - Target size in pixels (width and height)
 * @param callback - Called with error and image buffer
 */
export function resizeImg(
  inname: string,
  size: number,
  callback: ImageCallback
): void {
  sharp(inname)
    .resize(size, size, {
      kernel: sharp.kernel.nearest,  // Preserve pixelated look
    })
    .png()
    .toBuffer()
    .then((buffer) => callback(null, buffer))
    .catch((err) => callback(err, null));
}

// ============================================================================
// Default Skin Determination
// ============================================================================

/**
 * Determine the default skin type (Steve or Alex) based on UUID
 * 
 * Minecraft uses the UUID's hash to decide whether a player without
 * a custom skin should display as Steve (classic) or Alex (slim).
 * 
 * Algorithm: XOR the LSBs of every 4th byte in the UUID
 * - Odd result = Alex (slim model)
 * - Even result = Steve (classic model)
 * 
 * @param uuid - Minecraft UUID (32 hex characters, no dashes)
 * @returns 'mhf_alex' or 'mhf_steve'
 * 
 * @see https://git.io/xJpV - Minecrell's research on Minecraft UUID hashing
 */
export function defaultSkin(uuid: string): 'mhf_alex' | 'mhf_steve' {
  // MC uses `uuid.hashCode() & 1` for alex
  // That can be compacted to counting the LSBs of every 4th byte in the UUID
  // An odd sum means alex, an even sum means steve
  // XOR-ing all the LSBs gives us 1 for alex and 0 for steve
  const lsbsEven =
    parseInt(uuid[7], 16) ^
    parseInt(uuid[15], 16) ^
    parseInt(uuid[23], 16) ^
    parseInt(uuid[31], 16);

  return lsbsEven ? 'mhf_alex' : 'mhf_steve';
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read a skin image file from disk
 * 
 * @param rid - Request ID for logging
 * @param skinpath - Path to the skin file
 * @param callback - Called with error and image buffer
 */
export function openSkin(
  rid: string,
  skinpath: string,
  callback: ImageCallback
): void {
  fs.readFile(skinpath, (err, buf) => {
    if (err) {
      callback(err, null);
    } else {
      callback(null, buf);
    }
  });
}

/**
 * Save an image buffer to disk
 * 
 * The image is processed through sharp to ensure proper PNG format.
 * 
 * @param buffer - Image data buffer
 * @param outpath - Output file path
 * @param callback - Called with error or null on success
 */
export function saveImage(
  buffer: Buffer,
  outpath: string,
  callback: ErrorCallback
): void {
  sharp(buffer)
    .png()
    .toFile(outpath)
    .then(() => callback(null))
    .catch((err) => callback(err));
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  extractFace,
  extractHelm,
  resizeImg,
  defaultSkin,
  openSkin,
  saveImage,
};
