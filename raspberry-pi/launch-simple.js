#!/usr/bin/env node

/**
 * Simple launcher - gets URL from BBS and launches Chromium
 * Uses system Chromium by default for better compatibility
 * Usage: node launch-simple.js [--headless]
 */

// Pass through command line arguments
const args = process.argv.slice(2);
require('./src/simple-launcher.js');
