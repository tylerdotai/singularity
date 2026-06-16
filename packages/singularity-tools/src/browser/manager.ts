import { type Browser, chromium, type Page } from 'playwright';
import {
  BrowserEvaluationError,
  BrowserLaunchError,
  BrowserNavigationError,
  BrowserSelectorNotFoundError,
  BrowserUploadError,
} from './errors.js';

export interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_TIMEOUT = 30000;

class BrowserManagerImpl {
  private _browser: Browser | null = null;
  private _page: Page | null = null;
  private _options: BrowserOptions = {};

  private validateBrowser(): Browser {
    if (!this._browser?.isConnected()) {
      throw new BrowserLaunchError('Browser not running');
    }
    return this._browser;
  }

  async launch(options: BrowserOptions = {}): Promise<Browser> {
    if (this._browser?.isConnected()) {
      await this.close();
    }

    this._options = options;
    const headless = options.headless ?? true;
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;

    try {
      this._browser = await chromium.launch({ headless });
      const context = await this._browser.newContext({
        viewport,
      });
      this._page = await context.newPage();
      return this._browser;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserLaunchError(`Failed to launch browser: ${message}`);
    }
  }

  async close(): Promise<void> {
    if (this._page) {
      await this._page.close().catch(() => {});
      this._page = null;
    }
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }

  async getPage(): Promise<Page> {
    this.validateBrowser();
    if (!this._page) {
      throw new BrowserLaunchError('No page available');
    }
    return this._page;
  }

  async ensureBrowser(): Promise<Browser> {
    if (!this._browser || !this._browser.isConnected()) {
      const browser = await this.launch(this._options);
      return browser;
    }
    return this._browser;
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const page = await this.ensurePage();
    try {
      await page.goto(url, { timeout: DEFAULT_TIMEOUT });
      const title = await page.title();
      return { url: page.url(), title };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserNavigationError(`Navigation failed: ${message}`);
    }
  }

  async click(selector: string): Promise<void> {
    const page = await this.ensurePage();
    // Check if element exists first to avoid long waits
    const element = await page.$(selector);
    if (!element) {
      throw new BrowserSelectorNotFoundError(selector);
    }
    try {
      await element.click();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserSelectorNotFoundError(
        `Click failed for ${selector}: ${message}`
      );
    }
  }

  async fill(selector: string, text: string): Promise<void> {
    const page = await this.ensurePage();
    const element = await page.$(selector);
    if (!element) {
      throw new BrowserSelectorNotFoundError(selector);
    }
    try {
      await element.fill(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserSelectorNotFoundError(
        `Fill failed for ${selector}: ${message}`
      );
    }
  }

  async screenshot(
    selector?: string
  ): Promise<{ dataUrl: string; selector: string | null }> {
    const page = await this.ensurePage();
    try {
      if (selector) {
        const element = await page.locator(selector).first();
        const buffer = await element.screenshot();
        const base64 = buffer.toString('base64');
        return {
          dataUrl: `data:image/png;base64,${base64}`,
          selector,
        };
      }
      const buffer = await page.screenshot();
      const base64 = buffer.toString('base64');
      return {
        dataUrl: `data:image/png;base64,${base64}`,
        selector: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserNavigationError(`Screenshot failed: ${message}`);
    }
  }

  async evaluate(
    script: string
  ): Promise<{ result: unknown; console: string[] }> {
    const page = await this.ensurePage();
    const consoleMessages: string[] = [];

    const consoleHandler = (msg: {
      type: () => string;
      text: () => string;
    }) => {
      if (msg.type() === 'log' || msg.type() === 'info') {
        consoleMessages.push(msg.text());
      }
    };

    page.on('console', consoleHandler);

    try {
      const result = await page.evaluate(script, { timeout: DEFAULT_TIMEOUT });
      return { result, console: consoleMessages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserEvaluationError(`Evaluation failed: ${message}`);
    } finally {
      page.off('console', consoleHandler);
    }
  }

  async setInputFiles(selector: string, filePath: string): Promise<void> {
    const page = await this.ensurePage();
    try {
      await page.setInputFiles(selector, filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserUploadError(`Upload failed for ${selector}: ${message}`);
    }
  }

  async keypress(key: string): Promise<void> {
    const page = await this.ensurePage();
    try {
      await page.keyboard.press(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserEvaluationError(`Keypress failed: ${message}`);
    }
  }

  private async ensurePage(): Promise<Page> {
    await this.ensureBrowser();
    if (!this._page) {
      throw new BrowserLaunchError('No page available');
    }
    return this._page;
  }
}

let instance: BrowserManagerImpl | null = null;

export const BrowserManager = {
  getInstance(): BrowserManagerImpl {
    if (!instance) {
      instance = new BrowserManagerImpl();
    }
    return instance;
  },
};
