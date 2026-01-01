/**
 * @fileoverview Index Route Handler
 * 
 * Serves the main landing page with documentation and demo.
 * The page is pre-compiled using EJS templating for performance,
 * with optional re-compilation in debug mode for development.
 */

import logging from '../lib/logging';
import config from '../config';
import * as path from 'path';
import * as fs from 'fs';
import * as ejs from 'ejs';
import { CrafatarRequest, ResponseResult } from '../lib/response';

// ============================================================================
// Template Compilation
// ============================================================================

/** Cached template string */
let templateStr: string;

/** Compiled template function */
let compiledTemplate: ejs.TemplateFunction;

/**
 * Compile the index page template
 * 
 * Reads the EJS template from disk and compiles it for rendering.
 * This is called once on module load and optionally on each request
 * in debug mode to pick up template changes.
 */
function compileTemplate(): void {
  logging.log('Compiling index page');
  
  const templatePath = path.join(__dirname, '..', 'views', 'index.html.ejs');
  templateStr = fs.readFileSync(templatePath, 'utf-8');
  compiledTemplate = ejs.compile(templateStr);
}

// Compile template on module load
compileTemplate();

// ============================================================================
// Route Handler
// ============================================================================

/**
 * Handle GET request for the index page
 * 
 * Renders the documentation/demo page with configuration values
 * and the current domain for generating example URLs.
 * 
 * @param req - The incoming HTTP request
 * @param callback - Called with the response result
 */
export function indexRoute(
  req: CrafatarRequest,
  callback: (result: ResponseResult) => void
): void {
  // Re-compile template in debug mode to pick up changes
  if (config.server.debug_enabled) {
    compileTemplate();
  }

  // Render the template with configuration data
  const html = compiledTemplate({
    title: 'Crafatar',
    domain: 'https://' + req.headers['host'],
    config: config,
  });

  callback({
    body: html,
    type: 'text/html; charset=utf-8',
  });
}

export default indexRoute;
