import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readJson } from './common.mjs';
import { runCli, stopSite } from './studio-seed.mjs';

// WordPress.com's screenshot service, which Studio shows a remote site's thumbnail from.
const MSHOTS = 'https://s0.wp.com/mshots/v1/**';
const THUMB = { width: 600, height: 400 };
// The account's preview-site count and limit.
const USAGE = 'https://public-api.wordpress.com/wpcom/v2/jurassic-ninja/usage';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The WordPress.com and Pressable sites signed-in suites show instead of the
 * account's own, from `wpcom-sites.json`: each a `SyncSite` as Studio's
 * `fetchSyncableWpcomSites` returns it, plus `preview`, the slug of the demo
 * site whose front page stands in for its thumbnail.
 */
export async function loadWpcomSites( dir ) {
	const sites = await readJson( path.join( dir, 'wpcom-sites.json' ) );
	return sites.map( ( { preview, ...site } ) => ( {
		site: { localSiteId: '', lastPullTimestamp: null, lastPushTimestamp: null, ...site },
		preview,
	} ) );
}

/**
 * Screenshots the front page of every demo site a remote site borrows its
 * thumbnail from. The sites are started for this and stopped again, so Studio
 * launches with them as `seedSites` left them.
 */
export async function capturePreviews( profile, demoSites, remoteSites ) {
	const slugs = [ ...new Set( remoteSites.map( ( r ) => r.preview ).filter( Boolean ) ) ];
	const paths = Object.fromEntries(
		slugs.map( ( slug ) => {
			if ( ! demoSites.some( ( s ) => s.slug === slug ) ) {
				throw new Error( `wpcom-sites.json: no demo site "${ slug }" in sites.json` );
			}
			return [ slug, path.join( profile.dirs.sites, slug ) ];
		} )
	);
	const previews = {};
	const browser = await chromium.launch();
	try {
		for ( const sitePath of Object.values( paths ) ) {
			await runCli( profile, [
				'site',
				'start',
				'--path',
				sitePath,
				'--skip-browser',
				'--skip-log-details',
			] );
		}
		const list = JSON.parse( await runCli( profile, [ 'site', 'list', '--format', 'json' ] ) );
		const page = await browser.newPage( {
			viewport: { width: THUMB.width * 2, height: THUMB.height * 2 },
		} );
		for ( const [ slug, sitePath ] of Object.entries( paths ) ) {
			const { url } = list.find( ( s ) => s.path === sitePath );
			await page.goto( url, { waitUntil: 'networkidle' } );
			previews[ slug ] = await sharp( await page.screenshot() )
				.resize( THUMB.width, THUMB.height )
				.jpeg( { quality: 85 } )
				.toBuffer();
		}
	} finally {
		await browser.close();
		for ( const sitePath of Object.values( paths ) ) {
			await stopSite( profile, sitePath ).catch( () => {} );
		}
	}
	return previews;
}

/**
 * Makes a running Studio list `remoteSites` as the account's sites, and
 * serves their thumbnails from `previews`. Only the list is replaced: nothing
 * is sent to WordPress.com on the sites' behalf.
 */
export async function replaceWpcomSites( { app, window }, remoteSites, previews ) {
	await app.evaluate(
		( { ipcMain }, sites ) => {
			ipcMain.removeHandler( 'fetchSyncableWpcomSites' );
			ipcMain.handle( 'fetchSyncableWpcomSites', () => sites );
		},
		remoteSites.map( ( r ) => r.site )
	);
	await serveThumbnails( window, remoteSites, previews );
}

/**
 * The preview sites signed-in suites with `previewSites` show, from
 * `preview-sites.json`: each a `Snapshot` as Studio's `fetchSnapshots` returns
 * it, with `site` (the demo site's slug) in place of `localSiteId`, `ageDays`
 * in place of `date`, and `preview`, the demo site whose front page stands in
 * for its thumbnail.
 */
export async function loadPreviewSites( dir, demoSites ) {
	const entries = await readJson( path.join( dir, 'preview-sites.json' ) );
	return entries.map( ( { site, ageDays, preview, ...snapshot } ) => {
		const local = demoSites.find( ( s ) => s.slug === site );
		if ( ! local ) {
			throw new Error( `preview-sites.json: no demo site "${ site }" in sites.json` );
		}
		return {
			site: { ...snapshot, localSiteId: local.id, date: Date.now() - ageDays * DAY_MS },
			preview,
		};
	} );
}

/**
 * Makes a running Studio list `previewSites` as the preview sites of the
 * account `userId`, with a matching usage count, and serves their thumbnails
 * from `previews`.
 * Nothing is created or changed on WordPress.com.
 */
export async function replacePreviewSites( { app, window }, previewSites, previews, userId ) {
	await app.evaluate(
		( { ipcMain }, snapshots ) => {
			ipcMain.removeHandler( 'fetchSnapshots' );
			ipcMain.handle( 'fetchSnapshots', () => snapshots );
		},
		previewSites.map( ( p ) => ( { ...p.site, userId } ) )
	);
	await window.context().route( USAGE, ( route ) =>
		route.fulfill( {
			contentType: 'application/json',
			body: JSON.stringify( {
				site_count: previewSites.length,
				site_limit: 10,
				site_creation_blocked: false,
			} ),
		} )
	);
	await serveThumbnails( window, previewSites, previews );
}

// Answers mShots requests for `entries`' URLs with their demo site's front page.
async function serveThumbnails( window, entries, previews ) {
	await window.context().route( MSHOTS, ( route ) => {
		const target = bareUrl(
			decodeURIComponent( new URL( route.request().url() ).pathname.split( '/' ).pop() )
		);
		const entry = entries.find( ( e ) => bareUrl( e.site.url ) === target );
		const body = entry && previews[ entry.preview ];
		if ( body ) {
			return route.fulfill( { contentType: 'image/jpeg', body } );
		}
		return route.fallback();
	} );
}

function bareUrl( url ) {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}
