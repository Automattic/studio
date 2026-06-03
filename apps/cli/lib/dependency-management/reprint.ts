import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { downloadFile } from '@studio/common/lib/download-file';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getReprintPharPath } from './paths';

// reprint.phar is published as a release asset on the upstream reprint repository. Instead of
// bundling a snapshot with the CLI, we download the latest release into the writable cache and
// refresh it on the shared dependency-update throttle (see `updateServerFiles` in `setup.ts`).
const REPRINT_REPO = 'adamziel/reprint'; // TODO: Review this if the repo is moved to the Automattic repository
const REPRINT_ASSET = 'reprint.phar';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${ REPRINT_REPO }/releases/latest`;

interface ReprintRelease {
	tag: string;
	downloadUrl: string;
	// GitHub reports a per-asset content digest (e.g. "sha256:…"). We use it to verify the download
	// and to detect an asset replaced under an unchanged tag — GitHub releases are mutable, so a tag
	// alone is not a reliable freshness key. May be null for older assets that predate the field.
	digest: string | null;
}

interface InstalledReprint {
	tag: string | null;
	digest: string | null;
}

// reprint.phar has no readable embedded version, so we record the release tag and asset digest
// alongside it and compare against those to decide whether a newer release should be downloaded.
function getReprintVersionFilePath(): string {
	return path.join( path.dirname( getReprintPharPath() ), 'version.json' );
}

export async function fetchLatestReprintRelease(): Promise< ReprintRelease | null > {
	// GitHub rejects API requests without a User-Agent header.
	const response = await fetch( LATEST_RELEASE_URL, {
		headers: { 'User-Agent': 'studio', Accept: 'application/vnd.github+json' },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch latest reprint release: HTTP ${ response.status }` );
	}

	const release = ( await response.json() ) as {
		tag_name?: string;
		assets?: Array< { name?: string; browser_download_url?: string; digest?: string } >;
	};
	const asset = release.assets?.find( ( item ) => item.name === REPRINT_ASSET );
	if ( ! release.tag_name || ! asset?.browser_download_url ) {
		return null;
	}

	return {
		tag: release.tag_name,
		downloadUrl: asset.browser_download_url,
		digest: asset.digest ?? null,
	};
}

function readInstalledReprint(): InstalledReprint | null {
	try {
		const parsed = JSON.parse( fs.readFileSync( getReprintVersionFilePath(), 'utf8' ) ) as {
			tag?: unknown;
			digest?: unknown;
		};
		return {
			tag: typeof parsed.tag === 'string' ? parsed.tag : null,
			digest: typeof parsed.digest === 'string' ? parsed.digest : null,
		};
	} catch {
		return null;
	}
}

// The cached phar is current when it exists and matches the latest release. We compare on the asset
// digest when available (which also catches an asset swapped under an unchanged tag) and fall back
// to the tag when the release exposes no digest.
function isCachedReprintCurrent( release: ReprintRelease ): boolean {
	if ( ! fs.existsSync( getReprintPharPath() ) ) {
		return false;
	}
	const installed = readInstalledReprint();
	if ( ! installed ) {
		return false;
	}
	return release.digest ? installed.digest === release.digest : installed.tag === release.tag;
}

// Verifies a downloaded file against the GitHub-reported asset digest before it is installed.
async function verifyReprintDigest( filePath: string, digest: string ): Promise< void > {
	const [ algorithm, expectedHex ] = digest.split( ':' );
	if ( algorithm !== 'sha256' || ! expectedHex ) {
		throw new Error( `Unsupported reprint asset digest format: ${ digest }` );
	}
	const actualHex = crypto
		.createHash( 'sha256' )
		.update( await fs.promises.readFile( filePath ) )
		.digest( 'hex' );
	if ( actualHex !== expectedHex ) {
		throw new Error(
			`reprint.phar digest mismatch: expected sha256:${ expectedHex }, got sha256:${ actualHex }`
		);
	}
}

async function downloadReprint( release: ReprintRelease ): Promise< void > {
	const pharPath = getReprintPharPath();
	const reprintDir = path.dirname( pharPath );
	await fs.promises.mkdir( reprintDir, { recursive: true } );

	// Serialize downloads so concurrent processes (e.g. the daemon and a CLI invocation) don't
	// clobber each other's writes.
	const lockPath = `${ pharPath }.lock`;
	await lockFileAsync( lockPath, { wait: LOCKFILE_WAIT_TIME, stale: LOCKFILE_STALE_TIME } );
	try {
		// Re-check under the lock — another process may have installed this release while we waited.
		if ( isCachedReprintCurrent( release ) ) {
			return;
		}

		// Download to a temp file, verify its digest, then atomically rename so consumers never
		// observe a partial or unverified phar.
		const tmpPath = path.join( reprintDir, `reprint-${ crypto.randomUUID() }.phar.tmp` );
		try {
			await downloadFile( release.downloadUrl, tmpPath );
			if ( release.digest ) {
				await verifyReprintDigest( tmpPath, release.digest );
			}
			await fs.promises.chmod( tmpPath, 0o755 );
			await fs.promises.rename( tmpPath, pharPath );
		} finally {
			await fs.promises.rm( tmpPath, { force: true } );
		}

		await fs.promises.writeFile(
			getReprintVersionFilePath(),
			JSON.stringify( { tag: release.tag, digest: release.digest }, null, 2 ) + '\n'
		);
	} finally {
		await unlockFileAsync( lockPath );
	}
}

/**
 * Throttled entry point invoked by `updateServerFiles`. Downloads the latest reprint.phar release
 * when none is installed or the cached copy no longer matches the latest asset digest (or tag, when
 * no digest is published). Network/parse errors propagate to the caller, which logs and continues
 * with the other dependency checks.
 */
export async function updateLatestReprintPhar(): Promise< void > {
	const release = await fetchLatestReprintRelease();
	if ( ! release ) {
		return;
	}
	if ( isCachedReprintCurrent( release ) ) {
		return;
	}
	await downloadReprint( release );
}

/**
 * On-demand entry point for the pull-reprint flow. Returns the cached phar path immediately when
 * present (no network — this is called repeatedly during a pull), otherwise downloads and verifies
 * the latest release first. Throws if no phar is cached and the download cannot be resolved.
 */
export async function ensureReprintPharAvailable(): Promise< string > {
	const pharPath = getReprintPharPath();
	if ( fs.existsSync( pharPath ) ) {
		return pharPath;
	}

	const release = await fetchLatestReprintRelease();
	if ( ! release ) {
		throw new Error(
			`Unable to resolve a ${ REPRINT_ASSET } download from the latest ${ REPRINT_REPO } release.`
		);
	}

	await downloadReprint( release );
	return pharPath;
}
