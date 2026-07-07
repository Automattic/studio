import { describe, it, expect } from 'vitest';
import { assembleDesignTheme } from './assemble-design-theme.js';

describe('assembleDesignTheme', () => {
  it('rewrites CSS url() references to local upload URLs', () => {
    const mediaUrlMap = new Map([
      ['https://src.test/bg.jpg', '/wp-content/uploads/bg.jpg'],
    ]);
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: 'body { background: url("https://src.test/bg.jpg"); }',
      mediaUrlMap,
      headLinks: [],
    });

    const siteCssFile = files.find((f) => f.relativePath === 'site.css');
    expect(siteCssFile).toBeDefined();
    expect(siteCssFile!.content).toContain('/wp-content/uploads/bg.jpg');
    expect(siteCssFile!.content).not.toContain('https://src.test/bg.jpg');
  });

  it('returns theme scaffold files including style.css, functions.php, index.php, site.css', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: 'body { color: red; }',
      mediaUrlMap: new Map(),
      headLinks: [],
    });

    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('style.css');
    expect(paths).toContain('functions.php');
    expect(paths).toContain('index.php');
    expect(paths).toContain('site.css');
  });

  it('includes site.js and CSP in functions.php when jsText is non-empty', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: '',
      jsText: 'console.log("hello");',
      mediaUrlMap: new Map(),
      headLinks: [],
    });

    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('site.js');

    const siteJsFile = files.find((f) => f.relativePath === 'site.js');
    expect(siteJsFile!.content).toBe('console.log("hello");');

    const fnsFile = files.find((f) => f.relativePath === 'functions.php');
    expect(fnsFile!.content).toContain('Content-Security-Policy');
    expect(fnsFile!.content).toContain('site.js');
  });

  it('omits site.js and CSP when jsText is absent', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: 'body {}',
      jsText: undefined,
      mediaUrlMap: new Map(),
      headLinks: [],
    });

    const paths = files.map((f) => f.relativePath);
    expect(paths).not.toContain('site.js');

    const fnsFile = files.find((f) => f.relativePath === 'functions.php');
    expect(fnsFile!.content).not.toContain('Content-Security-Policy');
    expect(fnsFile!.content).not.toContain('site.js');
  });

  it('omits site.js when jsText is whitespace-only', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: '',
      jsText: '   \n  ',
      mediaUrlMap: new Map(),
      headLinks: [],
    });

    const paths = files.map((f) => f.relativePath);
    expect(paths).not.toContain('site.js');
  });

  it('uses the default themeSlug "dla-replica" when not specified', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: '',
      mediaUrlMap: new Map(),
      headLinks: [],
    });

    const styleFile = files.find((f) => f.relativePath === 'style.css');
    expect(styleFile!.content).toContain('dla-replica');
  });

  it('uses a custom themeSlug when provided', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: '',
      mediaUrlMap: new Map(),
      headLinks: [],
      themeSlug: 'my-site-replica',
    });

    const styleFile = files.find((f) => f.relativePath === 'style.css');
    expect(styleFile!.content).toContain('my-site-replica');
  });

  it('re-links CDN head links in functions.php', () => {
    const files = assembleDesignTheme({
      outputDir: '/tmp/test-output',
      cssText: '',
      mediaUrlMap: new Map(),
      headLinks: ['https://fonts.googleapis.com/css2?family=Roboto'],
    });

    const fnsFile = files.find((f) => f.relativePath === 'functions.php');
    expect(fnsFile!.content).toContain('fonts.googleapis.com/css2?family=Roboto');
  });
});
