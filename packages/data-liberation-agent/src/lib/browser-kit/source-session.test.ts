import { createServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectBrowser,
  sourceContextOptions,
  sourceSessionCookieHeader,
  __resetSourceSessionsForTests,
} from './browser-kit.js';
import { captureScreenshots } from '../screenshot/screenshotter.js';
import { downloadMedia } from '../media-fetch/media.js';

// validateOutputDir rejects paths outside cwd, so outputDirs live under a
// cwd-local .tmp-test dir (matches screenshot/smoke.test.ts).
const TMP_ROOT = join(process.cwd(), '.tmp-test');

// A 1x1 transparent PNG, so downloadMedia's content-type/extension checks pass.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const SESSION_COOKIE = 'session=letmein';

/**
 * Mimics a token-gated source: `/entry?token=...` sets a session cookie.
 * Every other path — including the media asset — returns 403 without that
 * cookie and 200 with it. No affordance for the client to persist cookies
 * itself; that's exactly what a bare cold context (or a bare `fetch`) fails
 * to do.
 */
function startGatedSource(): Promise<{
  url: string;
  requests: Array< { path: string; hadCookie: boolean } >;
  close: () => Promise< void >;
}> {
  const requests: Array< { path: string; hadCookie: boolean } > = [];
  const server: HttpServer = createServer( ( req, res ) => {
    const path = req.url ?? '/';
    const hadCookie = ( req.headers.cookie ?? '' ).includes( SESSION_COOKIE );
    requests.push( { path, hadCookie } );

    if ( path.startsWith( '/entry' ) ) {
      res.setHeader( 'set-cookie', `${ SESSION_COOKIE }; Path=/` );
      res.setHeader( 'content-type', 'text/html' );
      res.end(
        '<!doctype html><title>Entry</title><body>entry' +
          '<video src="/video.mp4" poster="/poster.jpg" preload="none"></video></body>'
      );
      return;
    }
    if ( path.startsWith( '/redirect-to-other' ) ) {
      const target = new URL( path, 'http://placeholder' ).searchParams.get( 'to' );
      res.writeHead( 302, { location: target ?? '/' } );
      res.end();
      return;
    }
    if ( ! hadCookie ) {
      res.writeHead( 403 );
      res.end();
      return;
    }
    if ( path.startsWith( '/media.png' ) ) {
      res.setHeader( 'content-type', 'image/png' );
      res.end( ONE_PIXEL_PNG );
      return;
    }
    // The browser never requests these (no autoplay, `preload="none"`): only
    // the DOM-dependency fetch inside CapturedResourceStore does, and that
    // fetch is a bare `safeFetch`, not the browser holding the harvested
    // session — exactly the surface this test proves carries the cookie too.
    if ( path.startsWith( '/video.mp4' ) ) {
      res.setHeader( 'content-type', 'video/mp4' );
      res.end( Buffer.from( 'fake mp4 bytes' ) );
      return;
    }
    if ( path.startsWith( '/poster.jpg' ) ) {
      res.setHeader( 'content-type', 'image/jpeg' );
      res.end( ONE_PIXEL_PNG );
      return;
    }
    res.setHeader( 'content-type', 'text/html' );
    res.end( `<!doctype html><title>${ path }</title><body>${ path }</body>` );
  } );
  return new Promise( ( resolve ) => {
    server.listen( 0, '127.0.0.1', () => {
      const port = ( server.address() as { port: number } ).port;
      resolve( {
        url: `http://localtest.me:${ port }`,
        requests,
        close: () =>
          new Promise< void >( ( r ) => {
            server.closeAllConnections();
            server.close( () => r() );
          } ),
      } );
    } );
  } );
}

/** A second, unrelated origin — the destination of a cross-origin redirect. */
function startOtherOrigin(): Promise< {
  url: string;
  sawCookie: boolean;
  requested: boolean;
  close: () => Promise< void >;
} > {
  const state = { sawCookie: false, requested: false };
  const server: HttpServer = createServer( ( req: IncomingMessage, res ) => {
    state.requested = true;
    if ( req.headers.cookie ) state.sawCookie = true;
    res.setHeader( 'content-type', 'image/png' );
    res.end( ONE_PIXEL_PNG );
  } );
  return new Promise( ( resolve ) => {
    server.listen( 0, '127.0.0.1', () => {
      const port = ( server.address() as { port: number } ).port;
      resolve( {
        url: `http://localtest.me:${ port }`,
        get sawCookie() {
          return state.sawCookie;
        },
        get requested() {
          return state.requested;
        },
        close: () =>
          new Promise< void >( ( r ) => {
            server.closeAllConnections();
            server.close( () => r() );
          } ),
      } );
    } );
  } );
}

describe.skipIf( process.env.SKIP_BROWSER_TESTS )( 'source session (real Chromium)', () => {
  let source: Awaited< ReturnType< typeof startGatedSource > >;

  beforeEach( async () => {
    __resetSourceSessionsForTests();
    mkdirSync( TMP_ROOT, { recursive: true } );
    source = await startGatedSource();
  } );

  afterEach( async () => {
    await source.close();
  } );

  it( 'captures sibling routes from parallel cold workers after harvesting the entry URL once', async () => {
    const outputDir = mkdtempSync( join( TMP_ROOT, 'session-capture-' ) );
    const entryUrl = `${ source.url }/entry?token=letmein`;
    const urls = [ entryUrl, `${ source.url }/sibling-a`, `${ source.url }/sibling-b` ];
    try {
      // concurrency 3 == every URL, including the two siblings that never
      // carry the token, starts in its own cold context at the same time —
      // exactly the shape that 403'd every non-entry route before this fix.
      const result = await captureScreenshots( {
        urls,
        outputDir,
        primaryUrl: entryUrl,
        concurrency: 3,
        captureImages: false,
      } );
      expect( result.failed ).toBe( 0 );
      const manifest = JSON.parse(
        readFileSync( join( outputDir, 'screenshots', 'manifest.json' ), 'utf8' )
      );
      expect( Object.keys( manifest.entries ) ).toHaveLength( 3 );
      // Capture itself navigates the entry URL twice (desktop + mobile
      // viewport) — the harvest must add exactly ONE more, not one per
      // worker. Three workers raced sourceContextOptions() concurrently
      // above; if the per-origin dedupe had failed, this would be higher.
      const entryNavigations = source.requests.filter( ( r ) => r.path.startsWith( '/entry' ) );
      expect( entryNavigations.length ).toBe( 3 );
    } finally {
      rmSync( outputDir, { recursive: true, force: true } );
    }
  }, 30_000 );

  it( 'captures a DOM-referenced video and poster through the harvested session', async () => {
    const outputDir = mkdtempSync( join( TMP_ROOT, 'session-video-' ) );
    const entryUrl = `${ source.url }/entry?token=letmein`;
    try {
      // Neither URL is ever requested by the browser itself: `preload="none"`
      // means Chromium never fetches the video, and the poster fetch (when it
      // happens) is still the browser's OWN request, not this code path's.
      // Only CapturedResourceStore's independent DOM-dependency fetch reaches
      // these — the bare `safeFetch` that used to drop the session entirely.
      const result = await captureScreenshots( {
        urls: [ entryUrl ],
        outputDir,
        primaryUrl: entryUrl,
        captureImages: false,
      } );
      expect( result.failed ).toBe( 0 );
      const manifest = JSON.parse(
        readFileSync( join( outputDir, 'resources', 'manifest.json' ), 'utf8' )
      );
      expect( manifest.resources[ `${ source.url }/video.mp4` ] ).toMatchObject( {
        contentType: 'video/mp4',
      } );
      expect( manifest.resources[ `${ source.url }/poster.jpg` ] ).toMatchObject( {
        contentType: 'image/jpeg',
      } );
      expect( manifest.failures ).toEqual( [] );
    } finally {
      rmSync( outputDir, { recursive: true, force: true } );
    }
  }, 30_000 );

  it( 'downloads media through the session harvested for its origin', async () => {
    const browser = await connectBrowser( {} );
    const mediaDir = mkdtempSync( join( TMP_ROOT, 'session-media-' ) );
    try {
      await sourceContextOptions( browser, `${ source.url }/entry?token=letmein` );
      const result = await downloadMedia( `${ source.url }/media.png`, mediaDir, new Map() );
      expect( result.error ).toBeNull();
      expect( result.localPath ).toBeTruthy();
      expect( existsSync( result.localPath as string ) ).toBe( true );
    } finally {
      await browser.close();
      rmSync( mediaDir, { recursive: true, force: true } );
    }
  }, 30_000 );

  it( 'seeds a freshly created context — a different browser instance — with the harvested session', async () => {
    const harvestBrowser = await connectBrowser( {} );
    let options: Awaited< ReturnType< typeof sourceContextOptions > >;
    try {
      options = await sourceContextOptions( harvestBrowser, `${ source.url }/entry?token=letmein` );
    } finally {
      await harvestBrowser.close();
    }
    expect( options.storageState?.cookies.some( ( c ) => c.name === 'session' ) ).toBe( true );

    // A brand-new browser — simulating a parallel worker or a post-restart
    // browser that never itself visited the entry URL.
    const freshBrowser = await connectBrowser( {} );
    try {
      const context = await freshBrowser.newContext( options );
      const page = await context.newPage();
      const response = await page.goto( `${ source.url }/sibling-fresh` );
      expect( response?.status() ).toBe( 200 );
      await context.close();
    } finally {
      await freshBrowser.close();
    }
  }, 30_000 );

  it( 'never forwards the harvested cookie to a different origin', async () => {
    const other = await startOtherOrigin();
    const mediaDir = mkdtempSync( join( TMP_ROOT, 'session-noleak-' ) );
    try {
      const browser = await connectBrowser( {} );
      try {
        await sourceContextOptions( browser, `${ source.url }/entry?token=letmein` );
      } finally {
        await browser.close();
      }

      const sourceOrigin = new URL( source.url ).origin;
      const otherOrigin = new URL( other.url ).origin;
      await expect( sourceSessionCookieHeader( sourceOrigin ) ).resolves.toContain( 'session=letmein' );
      await expect( sourceSessionCookieHeader( otherOrigin ) ).resolves.toBeUndefined();

      // Fetch layer: a redirect FROM the gated origin TO the other origin
      // must not carry the cookie across the hop.
      const redirectUrl = `${ source.url }/redirect-to-other?to=${ encodeURIComponent(
        `${ other.url }/asset.png`
      ) }`;
      await downloadMedia( redirectUrl, mediaDir, new Map() ).catch( () => {} );
      expect( other.requested ).toBe( true );
      expect( other.sawCookie ).toBe( false );
    } finally {
      await other.close();
      rmSync( mediaDir, { recursive: true, force: true } );
    }
  }, 30_000 );
} );
