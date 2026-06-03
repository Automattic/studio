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
}

// reprint.phar has no readable embedded version, so we record the release tag alongside it and
// compare against that to decide whether a newer release should be downloaded.
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
		assets?: Array< { name?: string; browser_download_url?: string } >;
	};
	const asset = release.assets?.find( ( item ) => item.name === REPRINT_ASSET );
	if ( ! release.tag_name || ! asset?.browser_download_url ) {
		return null;
	}

	return { tag: release.tag_name, downloadUrl: asset.browser_download_url };
}

export function getInstalledReprintVersion(): string | null {
	try {
		const parsed = JSON.parse( fs.readFileSync( getReprintVersionFilePath(), 'utf8' ) ) as {
			tag?: unknown;
		};
		return typeof parsed.tag === 'string' ? parsed.tag : null;
	} catch {
		return null;
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
		if ( fs.existsSync( pharPath ) && getInstalledReprintVersion() === release.tag ) {
			return;
		}

		// Download to a temp file and atomically rename so consumers never observe a partial phar.
		const tmpPath = path.join( reprintDir, `reprint-${ crypto.randomUUID() }.phar.tmp` );
		try {
			await downloadFile( release.downloadUrl, tmpPath );
			await fs.promises.chmod( tmpPath, 0o755 );
			await fs.promises.rename( tmpPath, pharPath );
		} finally {
			await fs.promises.rm( tmpPath, { force: true } );
		}

		await fs.promises.writeFile(
			getReprintVersionFilePath(),
			JSON.stringify( { tag: release.tag }, null, 2 ) + '\n'
		);
	} finally {
		await unlockFileAsync( lockPath );
	}
}

/**
 * Throttled entry point invoked by `updateServerFiles`. Downloads the latest reprint.phar release
 * when none is installed or a newer release is available. Network/parse errors propagate to the
 * caller, which logs and continues with the other dependency checks.
 */
export async function updateLatestReprintPhar(): Promise< void > {
	const release = await fetchLatestReprintRelease();
	if ( ! release ) {
		return;
	}

	if ( fs.existsSync( getReprintPharPath() ) && getInstalledReprintVersion() === release.tag ) {
		return;
	}

	await downloadReprint( release );
}

/**
 * On-demand entry point for the pull-reprint flow. Returns the cached phar path immediately when
 * present (no network — this is called repeatedly during a pull), otherwise downloads the latest
 * release first. Throws if no phar is cached and the download cannot be resolved.
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
