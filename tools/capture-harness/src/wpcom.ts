import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { readJson } from './paths.ts';
import { runCli, stopSite } from './studio-cli.ts';
import type { RemoteTrees } from './drivers/types.ts';
import type { Studio } from './launch.ts';
import type { Profile } from './profile.ts';
import type { LoadedScene, ResolvedSite } from './scene.ts';

// WordPress.com's screenshot service, which Studio shows a remote site's thumbnail from.
const MSHOTS = 'https://s0.wp.com/mshots/v1/**';
const THUMB = { width: 600, height: 400 };
const DAY_MS = 24 * 60 * 60 * 1000;

// A remote site, and the scene site whose front page stands in for its thumbnail.
export interface RemoteEntry {
	site: { url: string; [ key: string ]: unknown };
	preview?: string;
	connectedTo?: string;
}

/**
 * The WordPress.com and Pressable sites signed-in scripts show instead of the
 * account's own, from the scene's `account.wpcomSites`: each a `SyncSite` as
 * Studio's `fetchSyncableWpcomSites` returns it, plus `preview`, the slug of
 * the scene site whose front page stands in for its thumbnail, and optionally
 * `connectedTo`, the scene site it is connected to in `connectedSites` scripts.
 */
export async function loadWpcomSites( scene: LoadedScene ): Promise< RemoteEntry[] > {
	if ( ! scene.account.wpcomSites ) {
		return [];
	}
	const sites = await readJson< ( Record< string, unknown > & { url: string } )[] >(
		scene.account.wpcomSites
	);
	return sites.map( ( { preview, connectedTo, ...site } ) => ( {
		site: { localSiteId: '', lastPullTimestamp: null, lastPushTimestamp: null, ...site },
		preview: preview as string | undefined,
		connectedTo: connectedTo as string | undefined,
	} ) );
}

function sceneSite( sites: ResolvedSite[], slug: string, source: string ) {
	const site = sites.find( ( s ) => s.slug === slug );
	if ( ! site ) {
		throw new Error( `${ source }: no site "${ slug }" in the scene` );
	}
	return site;
}

/**
 * Screenshots the front page of every scene site a remote site borrows its
 * thumbnail from. The sites are started for this and stopped again, so Studio
 * launches with them as `seedSites` left them.
 */
export async function capturePreviews(
	profile: Profile,
	sites: ResolvedSite[],
	entries: RemoteEntry[]
) {
	const slugs = [ ...new Set( entries.map( ( r ) => r.preview ).filter( Boolean ) ) ] as string[];
	const paths = Object.fromEntries(
		slugs.map( ( slug ) => [
			sceneSite( sites, slug, 'account sites' ).slug,
			path.join( profile.dirs.sites, slug ),
		] )
	);
	const previews: Record< string, Buffer > = {};
	if ( ! slugs.length ) {
		return previews;
	}
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
		const list = JSON.parse( await runCli( profile, [ 'site', 'list', '--format', 'json' ] ) ) as {
			path: string;
			url: string;
		}[];
		const page = await browser.newPage( {
			viewport: { width: THUMB.width * 2, height: THUMB.height * 2 },
		} );
		for ( const [ slug, sitePath ] of Object.entries( paths ) ) {
			const listed = list.find( ( s ) => s.path === sitePath );
			if ( ! listed ) {
				throw new Error( `The CLI doesn't list ${ sitePath }` );
			}
			await page.goto( listed.url, { waitUntil: 'networkidle' } );
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
export async function replaceWpcomSites(
	studio: Studio,
	remoteSites: RemoteEntry[],
	previews: Record< string, Buffer >
) {
	await studio.stubs.syncableSites( remoteSites.map( ( r ) => r.site ) );
	await serveThumbnails( studio.window, remoteSites, previews );
}

/**
 * The preview sites signed-in scripts with `previewSites` show, from the
 * scene's `account.previewSites`: each a `Snapshot` as Studio's
 * `fetchSnapshots` returns it, with `site` (a scene site's slug) in place of
 * `localSiteId`, `ageDays` in place of `date`, and `preview`, the scene site
 * whose front page stands in for its thumbnail.
 */
export async function loadPreviewSites( scene: LoadedScene ): Promise< RemoteEntry[] > {
	if ( ! scene.account.previewSites ) {
		return [];
	}
	const entries = await readJson<
		( Record< string, unknown > & {
			url: string;
			site: string;
			ageDays: number;
			preview?: string;
		} )[]
	>( scene.account.previewSites );
	return entries.map( ( { site, ageDays, preview, ...snapshot } ) => ( {
		site: {
			...snapshot,
			localSiteId: sceneSite( scene.sites, site, 'account.previewSites' ).id,
			date: Date.now() - ageDays * DAY_MS,
		},
		preview,
	} ) );
}

/**
 * Makes a running Studio list `previewSites` as the preview sites of the
 * account `userId`, and serves their thumbnails from `previews`.
 * Nothing is created or changed on WordPress.com.
 */
export async function replacePreviewSites(
	studio: Studio,
	previewSites: RemoteEntry[],
	previews: Record< string, Buffer >,
	userId: number
) {
	await studio.stubs.previewSites( previewSites.map( ( p ) => ( { ...p.site, userId } ) ) );
	await serveThumbnails( studio.window, previewSites, previews );
}

/**
 * What every signed-in script reports for the account instead of
 * WordPress.com: the AI credits from `account.aiQuota`, so no shot shows the
 * real account's balance, the credit top-ups from `account.aiTopUpPricing`, and a preview-site usage that matches
 * `account.previewSites`. A scene without them shows the account's own.
 */
export async function loadAccount( scene: LoadedScene ) {
	return {
		aiQuota: scene.account.aiQuota ? await readJson( scene.account.aiQuota ) : undefined,
		aiTopUpPricing: scene.account.aiTopUpPricing
			? await readJson( scene.account.aiTopUpPricing )
			: undefined,
		previewSiteUrls: scene.account.previewSites
			? ( await readJson< { url: string }[] >( scene.account.previewSites ) ).map( ( p ) => p.url )
			: undefined,
	};
}

/**
 * Makes a running Studio treat the remote sites with `connectedTo` as
 * connected to that scene site, as if they had been connected through
 * Publish, and answers what the Publish panel asks WordPress.com about them:
 * the hosting PHP version, the latest backup, and the backup's files, which
 * are the scene site's own `wp-content`. Nothing is sent to WordPress.com, and
 * pulling or publishing is never started.
 */
export async function replaceConnectedSites(
	studio: Studio,
	remoteSites: RemoteEntry[],
	sites: ResolvedSite[],
	sitesDir: string
) {
	const connected = remoteSites
		.filter( ( r ) => r.connectedTo )
		.map( ( r ) => ( {
			...r.site,
			localSiteId: sceneSite( sites, r.connectedTo as string, 'account.wpcomSites' ).id,
			lastPullTimestamp: new Date( Date.now() - 5 * DAY_MS ).toISOString(),
			lastPushTimestamp: new Date( Date.now() - 2 * DAY_MS ).toISOString(),
		} ) );
	const trees: RemoteTrees = {};
	for ( const slug of new Set( remoteSites.map( ( r ) => r.connectedTo ).filter( Boolean ) ) ) {
		await listBackup( path.join( sitesDir, slug as string ), '/wp-content/', 3, trees );
	}
	await studio.stubs.connectedSites( connected, trees, {
		phpVersion: '8.3',
		rewindId: '1793318400.123',
	} );
}

// Studio's SQLite files, which a WordPress.com backup doesn't have.
const LOCAL_ONLY = new Set( [ '/wp-content/database', '/wp-content/db.php' ] );

// Lists `dir` of a site the way WordPress.com's backup browser does, `depth` levels down.
async function listBackup(
	sitePath: string,
	dir: string,
	depth: number,
	trees: Record< string, Record< string, unknown > >
) {
	const entries = ( await readdir( path.join( sitePath, dir ), { withFileTypes: true } ) ).filter(
		( e ) => ! e.name.startsWith( '.' ) && ! LOCAL_ONLY.has( `${ dir }${ e.name }` )
	);
	trees[ dir ] = Object.fromEntries(
		entries.map( ( e ) => [
			e.name,
			e.isDirectory()
				? { type: 'dir', has_children: true, id: `${ dir }${ e.name }/` }
				: { type: 'file', id: `${ dir }${ e.name }` },
		] )
	);
	if ( depth > 1 ) {
		for ( const e of entries.filter( ( entry ) => entry.isDirectory() ) ) {
			await listBackup( sitePath, `${ dir }${ e.name }/`, depth - 1, trees );
		}
	}
}

// Answers mShots requests for `entries`' URLs with their scene site's front page.
async function serveThumbnails(
	window: Page,
	entries: RemoteEntry[],
	previews: Record< string, Buffer >
) {
	await window.context().route( MSHOTS, ( route ) => {
		const target = bareUrl(
			decodeURIComponent( new URL( route.request().url() ).pathname.split( '/' ).pop() ?? '' )
		);
		const entry = entries.find( ( e ) => bareUrl( e.site.url ) === target );
		const body = entry?.preview && previews[ entry.preview ];
		if ( body ) {
			return route.fulfill( { contentType: 'image/jpeg', body } );
		}
		return route.fallback();
	} );
}

function bareUrl( url: string ) {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}
