#!/usr/bin/env node

/**
 * Check Puppeteer configuration
 */

const puppeteer = require('puppeteer');

console.log('Puppeteer version:', require('puppeteer/package.json').version);
console.log('Node version:', process.version);
console.log('Platform:', process.platform);

try {
  console.log('Default browser revision:', puppeteer._launcher?.BROWSER ?? 'unknown');
} catch (e) {
  console.log('Could not get browser info');
}

console.log('Testing basic launch...');
puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  timeout: 10000
}).then(browser => {
  console.log('✅ Basic launch successful');
  return browser.close();
}).catch(error => {
  console.error('❌ Basic launch failed:', error.message);
});






