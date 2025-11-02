const puppeteer = require('puppeteer');

(async () => {
  const url = process.argv[2] || 'https://example.com';
  console.log('WSL Direct Test - Navigating to:', url);

  const launchOptions = {
    headless: false,
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--ignore-certificate-errors',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-infobars',
      '--kiosk',
      '--start-fullscreen'
    ],
    dumpio: true,
    timeout: 60000,
    waitForInitialPage: false
  };

  try {
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    page.on('console', (msg) => console.log('[page]', msg.type(), msg.text()));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log('[page] navigated to:', frame.url());
      }
    });

    await page.bringToFront();
    console.log('Navigating now...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Navigation done. Waiting 5s...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await browser.close();
    console.log('Done.');
  } catch (err) {
    console.error('Direct test failed:', err.message);
    process.exit(1);
  }
})();






