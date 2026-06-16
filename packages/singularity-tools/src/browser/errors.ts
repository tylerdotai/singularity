export type BrowserErrorKind =
  | 'launch_failed'
  | 'navigation_failed'
  | 'selector_not_found'
  | 'evaluation_error'
  | 'upload_failed';

export class BrowserError extends Error {
  constructor(
    public message: string,
    public kind: BrowserErrorKind
  ) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class BrowserLaunchError extends BrowserError {
  constructor(message: string) {
    super(message, 'launch_failed');
    this.name = 'BrowserLaunchError';
  }
}

export class BrowserNavigationError extends BrowserError {
  constructor(message: string) {
    super(message, 'navigation_failed');
    this.name = 'BrowserNavigationError';
  }
}

export class BrowserSelectorNotFoundError extends BrowserError {
  constructor(selector: string) {
    super(`Selector not found: ${selector}`, 'selector_not_found');
    this.name = 'BrowserSelectorNotFoundError';
  }
}

export class BrowserEvaluationError extends BrowserError {
  constructor(message: string) {
    super(message, 'evaluation_error');
    this.name = 'BrowserEvaluationError';
  }
}

export class BrowserUploadError extends BrowserError {
  constructor(message: string) {
    super(message, 'upload_failed');
    this.name = 'BrowserUploadError';
  }
}
