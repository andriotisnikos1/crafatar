/**
 * @fileoverview Object Utility Functions
 * 
 * Provides utility functions for working with nested object properties.
 * These utilities help safely access deeply nested values without
 * risking runtime errors from undefined intermediate properties.
 */

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safely access a nested property in an object using dot notation
 * 
 * This function traverses an object following a dot-separated path string,
 * returning undefined if any intermediate property doesn't exist rather
 * than throwing an error.
 * 
 * @template T - Expected return type
 * @param obj - The object to traverse
 * @param pathstr - Dot-separated path string (e.g., "foo.bar.baz")
 * @returns The value at the specified path, or undefined if not found
 * 
 * @example
 * // Returns 123
 * getNestedProperty({ foo: { bar: 123 } }, 'foo.bar');
 * 
 * @example
 * // Returns undefined (doesn't throw)
 * getNestedProperty({ foo: { bar: 123 } }, 'bar.foo');
 * 
 * @example
 * // With type parameter
 * const url = getNestedProperty<string>(profile, 'textures.SKIN.url');
 */
export function getNestedProperty<T = unknown>(
  obj: Record<string, unknown>,
  pathstr: string
): T | undefined {
  // Split the path into individual property names
  const path = pathstr.split('.');
  let result: unknown = obj;

  // Traverse each level of the path
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    
    // Check if we can continue traversing
    if (
      !result ||
      typeof result !== 'object' ||
      !Object.prototype.hasOwnProperty.call(result, key)
    ) {
      return undefined;
    }
    
    // Move to the next level
    result = (result as Record<string, unknown>)[key];
  }

  return result as T;
}
