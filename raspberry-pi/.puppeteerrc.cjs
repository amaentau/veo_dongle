const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Use system Chromium
  executablePath: '/usr/bin/chromium-browser',
  
  // WSL-specific launch options
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-dev-tools',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-translate',
    '--disable-extensions',
    '--disable-sync'
  ]
};
