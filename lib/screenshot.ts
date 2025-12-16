/**
 * Screenshot utility for capturing live websites
 * Uses Playwright for reliable browser automation
 */

import { chromium, Browser, Page } from 'playwright';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

export async function screenshotUrl(url: string, options?: {
  width?: number;
  height?: number;
  timeout?: number;
}): Promise<Buffer> {
  const { width = 1920, height = 1080, timeout = 15000 } = options || {};
  
  const browserInstance = await getBrowser();
  const context = await browserInstance.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2, // Retina quality
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to URL with timeout
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });
    
    // Wait a bit for any animations to settle
    await page.waitForTimeout(1000);
    
    // Try to dismiss common cookie banners/modals
    await dismissPopups(page);
    
    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false, // Just the viewport
    });
    
    return screenshot;
  } finally {
    await context.close();
  }
}

async function dismissPopups(page: Page): Promise<void> {
  // Common cookie banner selectors
  const dismissSelectors = [
    '[data-testid="cookie-banner"] button',
    '.cookie-banner button',
    '#cookie-consent button',
    '[class*="cookie"] button[class*="accept"]',
    '[class*="cookie"] button[class*="close"]',
    '[class*="modal"] button[class*="close"]',
    '[aria-label="Close"]',
    '[aria-label="Dismiss"]',
  ];
  
  for (const selector of dismissSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // Ignore errors - popup might not exist
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Validate if a URL is accessible
export async function isUrlAccessible(url: string, timeout = 5000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok;
  } catch {
    return false;
  }
}
