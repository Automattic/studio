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
 * Data Liberation engine and Static Site Importer, resolved at launch and verified against the
 * SHA-256 digest GitHub publishes for each release asset. Shipping either
 * project therefore changes Studio's imports without a Studio release.
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
 * Make the engine's external Playwright import resolve to the copy Studio
 * ships, so the release bundle runs without its own dependency install.
 */
function linkPlaywright( engineRoot: string ): void {
	const require = createRequire( import.meta.url );
	const playwrightRoot = path.dirname( require.resolve( 'playwright/package.json' ) );
	const target = path.join( engineRoot, 'node_modules', 'playwright' );
	if ( fs.existsSync( target ) ) {
		return;
	}
	fs.mkdirSync( path.dirname( target ), { recursive: true } );
	try {
		fs.symlinkSync( playwrightRoot, target, os.platform() === 'win32' ? 'junction' : 'dir' );
	} catch ( error ) {
		// A concurrent import linked it first.
		if ( ( error as NodeJS.ErrnoException ).code !== 'EEXIST' ) {
			throw error;
		}
	}
}

/** Install (once per version) and load the newest Data Liberation capture engine. */
export async function loadCaptureEngine(): Promise< CaptureEngine > {
	const asset = await resolveLatestReleaseAsset(
		DATA_LIBERATION_REPO,
		( name, version ) => name === `data-liberation-${ version }.tgz`
	);
	const engineRoot = path.join( runtimeDirectory(), 'data-liberation', asset.version );
	const bundlePath = path.join( engineRoot, 'dist', 'capture-engine.bundle.mjs' );
	const isCompleteEngine = ( directory: string ) =>
		fs.existsSync( path.join( directory, 'dist', 'capture-engine.bundle.mjs' ) );
	if ( ! isCompleteEngine( engineRoot ) ) {
		const staging = `${ engineRoot }.staging-${ uniqueSuffix() }`;
		fs.mkdirSync( staging, { recursive: true } );
		const archive = path.join( staging, asset.name );
		try {
			await downloadVerifiedAsset( asset, archive );
			await tar.x( { file: archive, cwd: staging, strip: 1 } );
			fs.rmSync( archive, { force: true } );
			const manifest = JSON.parse(
				fs.readFileSync( path.join( staging, 'package.json' ), 'utf8' )
			) as { version?: string };
			if ( manifest.version !== asset.version ) {
				throw new Error(
					`Data Liberation engine is ${ manifest.version }, expected ${ asset.version }.`
				);
			}
			if ( ! isCompleteEngine( staging ) ) {
				throw new Error( 'Data Liberation release is missing its capture engine bundle.' );
			}
			publishStagedInstall( staging, engineRoot, isCompleteEngine );
		} finally {
			fs.rmSync( staging, { recursive: true, force: true } );
		}
	}
	linkPlaywright( engineRoot );
	const engine = ( await import( pathToFileURL( bundlePath ).href ) ) as Partial< CaptureEngine >;
	if ( typeof engine.captureWebsite !== 'function' ) {
		throw new Error( `Data Liberation ${ asset.version } does not export the capture engine API.` );
	}
	return { ...( engine as CaptureEngine ), version: asset.version, packageUrl: asset.url };
}

/** The newest Static Site Importer release ZIP, downloaded and verified once per version. */
export async function resolveStaticSiteImporterPlugin(): Promise< {
	path: string;
	version: string;
} > {
	const asset = await resolveLatestReleaseAsset(
		STATIC_SITE_IMPORTER_REPO,
		( name ) => name === STATIC_SITE_IMPORTER_ASSET
	);
	const zipPath = path.join(
		runtimeDirectory(),
		'static-site-importer',
		asset.version,
		asset.name
	);
	if ( ! fs.existsSync( zipPath ) ) {
		await downloadVerifiedAsset( asset, zipPath );
	}
	return { path: zipPath, version: asset.version };
}

export function resetImportRuntimeCacheForTests(): void {
	resolvedReleases.clear();
}
