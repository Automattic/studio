import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import * as tar from 'tar';

/**
 * The import pipeline behind `studio create --from` runs the newest stable
 * Data Liberation engine and Static Site Importer, verified against the
 * SHA-256 digest GitHub publishes for each release asset. Shipping either
 * project therefore changes Studio's imports without a Studio release.
 *
 * A release is installed once per version. Once one is installed it is used
 * at once, and a newer release is installed in the background for the next
 * import, so an import never waits on a download it does not need.
 */
export type ReleaseAsset = {
	repo: string;
	version: string;
	name: string;
	url: string;
	sha256: string;
};

export type CaptureEngine = {
	version: string;
	/** The verified release tarball, runnable as `npx --package=<url> data-liberation`. */
	packageUrl: string;
	captureWebsite: ( options: {
		url: string;
		outputDir: string;
		onProgress?: ( progress: {
			phase: string;
			current?: number;
			total?: number;
			url?: string;
		} ) => void;
	} ) => Promise< {
		captureReceiptPath: string;
		outputDir: string;
		summary: {
			routesDiscovered: number;
			routesCaptured: number;
			routesSkipped: number;
			routesFailed: number;
		};
	} >;
};

const DATA_LIBERATION_REPO = 'Automattic/data-liberation-agent';
const STATIC_SITE_IMPORTER_REPO = 'Automattic/static-site-importer';
const STATIC_SITE_IMPORTER_ASSET = 'static-site-importer-html-site-import.zip';
const RELEASE_CACHE_MS = 5 * 60 * 1000;
const MAX_ASSET_BYTES = 200 * 1024 * 1024;

const resolvedReleases = new Map< string, { at: number; asset: ReleaseAsset } >();
const pendingUpdates = new Map< string, Promise< InstalledRelease > >();

function runtimeDirectory(): string {
	return path.join( getConfigDirectory(), 'import-runtime' );
}

type ResolvedRelease = { at: number; asset: ReleaseAsset };

/** The last release resolved for `repo`, shared by every Studio process. */
function releaseRecordPath( repo: string ): string {
	return path.join( runtimeDirectory(), 'releases', `${ repo.replace( '/', '__' ) }.json` );
}

function readReleaseRecord( repo: string ): ResolvedRelease | null {
	try {
		const record = JSON.parse(
			fs.readFileSync( releaseRecordPath( repo ), 'utf8' )
		) as ResolvedRelease;
		return typeof record.at === 'number' && record.asset?.repo === repo ? record : null;
	} catch {
		return null;
	}
}

function writeReleaseRecord( record: ResolvedRelease ): void {
	const destination = releaseRecordPath( record.asset.repo );
	const partial = `${ destination }.partial-${ uniqueSuffix() }`;
	try {
		fs.mkdirSync( path.dirname( destination ), { recursive: true } );
		fs.writeFileSync( partial, JSON.stringify( record ) );
		fs.renameSync( partial, destination );
	} catch {
		// The record only saves lookups; an import never fails for want of it.
		fs.rmSync( partial, { force: true } );
	}
}

/**
 * The newest stable release of `repo` and its asset matching `matchesAsset`.
 * A release without that asset, or without a published digest, is refused
 * rather than silently falling back to an older one.
 *
 * Lookups are shared on disk for a few minutes, so parallel imports make one
 * GitHub request instead of one each. When GitHub cannot be reached (offline,
 * or the unauthenticated rate limit), the last release this machine verified
 * is used instead of failing the import.
 */
export async function resolveLatestReleaseAsset(
	repo: string,
	matchesAsset: ( name: string, version: string ) => boolean,
	fetchImpl: typeof fetch = fetch
): Promise< ReleaseAsset > {
	const cached = resolvedReleases.get( repo );
	if ( cached && Date.now() - cached.at < RELEASE_CACHE_MS ) {
		return cached.asset;
	}
	const recorded = readReleaseRecord( repo );
	if ( recorded && Date.now() - recorded.at < RELEASE_CACHE_MS ) {
		resolvedReleases.set( repo, recorded );
		return recorded.asset;
	}
	const headers: Record< string, string > = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'wordpress-studio',
	};
	if ( process.env.GITHUB_TOKEN ) {
		headers.Authorization = `Bearer ${ process.env.GITHUB_TOKEN }`;
	}
	let response: Response;
	try {
		response = await fetchImpl( `https://api.github.com/repos/${ repo }/releases/latest`, {
			headers,
		} );
	} catch ( error ) {
		return lastVerifiedRelease( repo, recorded, ( error as Error ).message );
	}
	if ( ! response.ok ) {
		return lastVerifiedRelease( repo, recorded, `HTTP ${ response.status }` );
	}
	const release = ( await response.json() ) as {
		tag_name?: string;
		prerelease?: boolean;
		draft?: boolean;
		assets?: Array< { name?: string; browser_download_url?: string; digest?: string | null } >;
	};
	const version = ( release.tag_name ?? '' ).replace( /^v/, '' );
	if ( ! /^\d+\.\d+\.\d+$/.test( version ) || release.prerelease || release.draft ) {
		throw new Error( `${ repo } has no stable release.` );
	}
	const asset = release.assets?.find( ( candidate ) =>
		matchesAsset( candidate.name ?? '', version )
	);
	const sha256 = asset?.digest?.startsWith( 'sha256:' )
		? asset.digest.slice( 'sha256:'.length )
		: '';
	if ( ! asset?.name || ! asset.browser_download_url || ! /^[0-9a-f]{64}$/.test( sha256 ) ) {
		throw new Error( `${ repo } ${ version } is missing its verifiable runtime asset.` );
	}
	const resolved: ReleaseAsset = {
		repo,
		version,
		name: asset.name,
		url: asset.browser_download_url,
		sha256,
	};
	const record = { at: Date.now(), asset: resolved };
	resolvedReleases.set( repo, record );
	writeReleaseRecord( record );
	return resolved;
}

function lastVerifiedRelease(
	repo: string,
	recorded: ResolvedRelease | null,
	reason: string
): ReleaseAsset {
	if ( ! recorded ) {
		throw new Error( `${ repo } latest release lookup failed (${ reason }).` );
	}
	process.stderr.write(
		`Could not check ${ repo } for a newer release (${ reason }); using ${ recorded.asset.version }.\n`
	);
	return recorded.asset;
}

/** Download `asset` to `destination`, refusing bytes that do not match its digest. */
export async function downloadVerifiedAsset(
	asset: ReleaseAsset,
	destination: string,
	fetchImpl: typeof fetch = fetch
): Promise< void > {
	const response = await fetchImpl( asset.url, { redirect: 'follow' } );
	if ( ! response.ok || ! response.body ) {
		throw new Error( `Downloading ${ asset.name } failed (HTTP ${ response.status }).` );
	}
	fs.mkdirSync( path.dirname( destination ), { recursive: true } );
	// Unique per download: concurrent imports may fetch the same asset at once.
	const partial = `${ destination }.partial-${ uniqueSuffix() }`;
	const hash = crypto.createHash( 'sha256' );
	let bytes = 0;
	await pipeline(
		Readable.fromWeb( response.body as Parameters< typeof Readable.fromWeb >[ 0 ] ),
		async function* ( source ) {
			for await ( const chunk of source ) {
				bytes += chunk.length;
				if ( bytes > MAX_ASSET_BYTES ) {
					throw new Error( `${ asset.name } exceeds the runtime asset size limit.` );
				}
				hash.update( chunk );
				yield chunk;
			}
		},
		fs.createWriteStream( partial )
	);
	const actual = hash.digest( 'hex' );
	if ( actual !== asset.sha256 ) {
		fs.rmSync( partial, { force: true } );
		throw new Error( `${ asset.name } does not match its published SHA-256 digest.` );
	}
	// Replacing a file is atomic, and a concurrent winner wrote identical
	// verified bytes, so the last rename is as good as the first.
	fs.renameSync( partial, destination );
}

function uniqueSuffix(): string {
	return `${ process.pid }-${ crypto.randomBytes( 4 ).toString( 'hex' ) }`;
}

/**
 * Publish a fully staged install at `target` for concurrent imports.
 *
 * The staged directory is renamed into place; renaming is atomic, so readers
 * only ever see a complete install. When another process published first,
 * its install is kept and this staging directory is discarded. A complete
 * install is never removed, because another running import may be using it.
 * An incomplete directory at `target` is moved aside, then replaced.
 */
export function publishStagedInstall(
	staging: string,
	target: string,
	isComplete: ( directory: string ) => boolean
): void {
	for ( let attempt = 0; attempt < 2; attempt++ ) {
		try {
			fs.renameSync( staging, target );
			return;
		} catch ( error ) {
			if ( isComplete( target ) ) {
				fs.rmSync( staging, { recursive: true, force: true } );
				return;
			}
			if ( attempt > 0 || ! fs.existsSync( target ) ) {
				throw error;
			}
			const stale = `${ target }.stale-${ uniqueSuffix() }`;
			try {
				fs.renameSync( target, stale );
			} catch {
				// Another process moved or replaced it; retry the publish.
			}
			fs.rmSync( stale, { recursive: true, force: true } );
		}
	}
}

/**
 * Make the engine's external Playwright import resolve to the copy this Studio
 * ships, so the release bundle runs without its own dependency install.
 *
 * The runtime cache outlives any one Studio install: an update or a moved
 * checkout leaves the link pointing at a Playwright that no longer exists. The
 * link is re-pointed whenever it does not target this Studio's copy, and
 * swapped in with a rename so a concurrent import never sees it missing.
 */
export function linkPlaywright(
	engineRoot: string,
	playwrightRoot = bundledPlaywrightRoot()
): void {
	const target = path.join( engineRoot, 'node_modules', 'playwright' );
	let current: string | undefined;
	try {
		current = fs.readlinkSync( target );
	} catch {
		// Missing, or not a link.
	}
	if ( current && path.resolve( path.dirname( target ), current ) === playwrightRoot ) {
		return;
	}
	fs.mkdirSync( path.dirname( target ), { recursive: true } );
	const staged = `${ target }.link-${ uniqueSuffix() }`;
	fs.symlinkSync( playwrightRoot, staged, os.platform() === 'win32' ? 'junction' : 'dir' );
	try {
		fs.renameSync( staged, target );
	} catch {
		// Windows cannot rename over an existing junction: remove the stale one first.
		fs.rmSync( target, { recursive: false, force: true } );
		try {
			fs.renameSync( staged, target );
		} catch ( error ) {
			fs.rmSync( staged, { force: true } );
			// A concurrent import may have linked it first; anything else is fatal.
			if ( fs.readlinkSync( target ) !== playwrightRoot ) {
				throw error;
			}
		}
	}
}

function bundledPlaywrightRoot(): string {
	const require = createRequire( import.meta.url );
	return path.dirname( require.resolve( 'playwright/package.json' ) );
}

export type InstalledRelease = { root: string; asset: ReleaseAsset };

const ASSET_RECORD = 'release-asset.json';

const compareVersions = ( a: string, b: string ) => {
	const [ x, y ] = [ a, b ].map( ( version ) => version.split( '.' ).map( Number ) );
	return x.map( ( part, i ) => part - y[ i ] ).find( ( difference ) => difference !== 0 ) ?? 0;
};

/** The complete installs in `directory`, newest first. */
function installedReleases(
	directory: string,
	isComplete: ( root: string ) => boolean
): InstalledRelease[] {
	let names: string[] = [];
	try {
		names = fs.readdirSync( directory );
	} catch {
		return [];
	}
	return names
		.filter( ( name ) => /^\d+\.\d+\.\d+$/.test( name ) )
		.flatMap( ( name ) => {
			const root = path.join( directory, name );
			try {
				const asset = JSON.parse(
					fs.readFileSync( path.join( root, ASSET_RECORD ), 'utf8' )
				) as ReleaseAsset;
				return isComplete( root ) ? [ { root, asset } ] : [];
			} catch {
				return [];
			}
		} )
		.sort( ( a, b ) => compareVersions( b.asset.version, a.asset.version ) );
}

/**
 * Remove what no import can still use: every version but the two newest
 * complete installs, so one that started on the previous version keeps its
 * files, and staging left by a Studio process that has exited.
 */
function pruneReleases( directory: string, isComplete: ( root: string ) => boolean ): void {
	const kept = new Set(
		installedReleases( directory, isComplete )
			.slice( 0, 2 )
			.map( ( { root } ) => path.basename( root ) )
	);
	for ( const name of fs.readdirSync( directory ) ) {
		const owner = /\.(?:staging|stale)-(\d+)-/.exec( name )?.[ 1 ];
		const abandoned = owner !== undefined && ! isRunning( Number( owner ) );
		if ( abandoned || ( /^\d+\.\d+\.\d+$/.test( name ) && ! kept.has( name ) ) ) {
			fs.rmSync( path.join( directory, name ), { recursive: true, force: true } );
		}
	}
}

function isRunning( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		// EPERM: it runs, as another user.
		return ( error as NodeJS.ErrnoException ).code === 'EPERM';
	}
}

/**
 * The newest installed release of a runtime, installing the newest published
 * one first only when none is installed. With one installed, the newest
 * published release is installed in the background for the next caller,
 * one update at a time, and installs no import can use any more are removed.
 *
 * `install` fills a staging directory from the verified asset; it is
 * published under the release's version once `isComplete` holds for it.
 */
export async function installedRuntime( {
	directory,
	resolve,
	install,
	isComplete,
}: {
	directory: string;
	resolve: () => Promise< ReleaseAsset >;
	install: ( asset: ReleaseAsset, staging: string ) => Promise< void >;
	isComplete: ( root: string ) => boolean;
} ): Promise< InstalledRelease > {
	const update = () => {
		let pending = pendingUpdates.get( directory );
		if ( ! pending ) {
			pending = installRelease( directory, resolve, install, isComplete ).finally( () =>
				pendingUpdates.delete( directory )
			);
			pendingUpdates.set( directory, pending );
		}
		return pending;
	};
	const [ installed ] = installedReleases( directory, isComplete );
	if ( ! installed ) {
		return update();
	}
	update().catch( () => {
		// The next import tries again; this one has what it needs.
	} );
	return installed;
}

async function installRelease(
	directory: string,
	resolve: () => Promise< ReleaseAsset >,
	install: ( asset: ReleaseAsset, staging: string ) => Promise< void >,
	isComplete: ( root: string ) => boolean
): Promise< InstalledRelease > {
	const asset = await resolve();
	const root = path.join( directory, asset.version );
	const isInstalled = ( candidate: string ) =>
		fs.existsSync( path.join( candidate, ASSET_RECORD ) ) && isComplete( candidate );
	if ( ! isInstalled( root ) ) {
		const staging = `${ root }.staging-${ uniqueSuffix() }`;
		fs.mkdirSync( staging, { recursive: true } );
		try {
			await install( asset, staging );
			fs.writeFileSync( path.join( staging, ASSET_RECORD ), JSON.stringify( asset ) );
			if ( ! isInstalled( staging ) ) {
				throw new Error( `${ asset.repo } ${ asset.version } did not install completely.` );
			}
			publishStagedInstall( staging, root, isInstalled );
		} finally {
			fs.rmSync( staging, { recursive: true, force: true } );
		}
	}
	pruneReleases( directory, isInstalled );
	return { root, asset };
}

/** The newest Data Liberation release package. */
export function resolveCaptureEngineAsset(): Promise< ReleaseAsset > {
	return resolveLatestReleaseAsset(
		DATA_LIBERATION_REPO,
		( name, version ) => name === `data-liberation-${ version }.tgz`
	);
}

/** Load the installed Data Liberation capture engine (see installedRuntime). */
export async function loadCaptureEngine(): Promise< CaptureEngine > {
	const bundleOf = ( root: string ) => path.join( root, 'dist', 'capture-engine.bundle.mjs' );
	const { root: engineRoot, asset } = await installedRuntime( {
		directory: path.join( runtimeDirectory(), 'data-liberation' ),
		resolve: resolveCaptureEngineAsset,
		isComplete: ( root ) => fs.existsSync( bundleOf( root ) ),
		install: async ( release, staging ) => {
			const archive = path.join( staging, release.name );
			await downloadVerifiedAsset( release, archive );
			await tar.x( { file: archive, cwd: staging, strip: 1 } );
			fs.rmSync( archive, { force: true } );
			const manifest = JSON.parse(
				fs.readFileSync( path.join( staging, 'package.json' ), 'utf8' )
			) as { version?: string };
			if ( manifest.version !== release.version ) {
				throw new Error(
					`Data Liberation engine is ${ manifest.version }, expected ${ release.version }.`
				);
			}
		},
	} );
	const bundlePath = bundleOf( engineRoot );
	linkPlaywright( engineRoot );
	const engine = ( await import( pathToFileURL( bundlePath ).href ) ) as Partial< CaptureEngine >;
	if ( typeof engine.captureWebsite !== 'function' ) {
		throw new Error( `Data Liberation ${ asset.version } does not export the capture engine API.` );
	}
	return { ...( engine as CaptureEngine ), version: asset.version, packageUrl: asset.url };
}

/** The installed Static Site Importer release ZIP (see installedRuntime). */
export async function resolveStaticSiteImporterPlugin(): Promise< {
	path: string;
	version: string;
} > {
	const zipOf = ( root: string ) => path.join( root, STATIC_SITE_IMPORTER_ASSET );
	const { root, asset } = await installedRuntime( {
		directory: path.join( runtimeDirectory(), 'static-site-importer' ),
		resolve: () =>
			resolveLatestReleaseAsset(
				STATIC_SITE_IMPORTER_REPO,
				( name ) => name === STATIC_SITE_IMPORTER_ASSET
			),
		isComplete: ( candidate ) => fs.existsSync( zipOf( candidate ) ),
		install: ( release, staging ) => downloadVerifiedAsset( release, zipOf( staging ) ),
	} );
	return { path: zipOf( root ), version: asset.version };
}

export function resetImportRuntimeCacheForTests(): void {
	resolvedReleases.clear();
	pendingUpdates.clear();
}
