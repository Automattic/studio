import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Ambient provider for the directory screenshot captures are saved to,
 * mirroring `setChatArtifactCallback`. The `studio code` command points it at
 * a per-session sidecar directory (`<session>.screenshots/` next to the
 * session JSONL) so screenshots referenced by persisted chat artifacts
 * survive OS temp cleanup and are removed together with the session.
 * Standalone CLI/MCP runs never set a provider and fall back to a throwaway
 * temp directory.
 */
type ScreenshotDirectoryProvider = () => Promise< string | null > | string | null;

let screenshotDirectoryProvider: ScreenshotDirectoryProvider | null = null;

export function setScreenshotDirectoryProvider(
	provider: ScreenshotDirectoryProvider | null
): void {
	screenshotDirectoryProvider = provider;
}

export async function resolveScreenshotDirectory(): Promise< string > {
	try {
		const directory = await screenshotDirectoryProvider?.();
		if ( directory ) {
			await mkdir( directory, { recursive: true } );
			return directory;
		}
	} catch ( error ) {
		// Fall through to the temp directory so the capture still succeeds, but
		// say so: files there are purged by the OS, so persisted artifacts will
		// eventually show as unavailable and this line is the only clue why.
		console.warn( '[screenshots] falling back to a temporary directory:', error );
	}
	return mkdtemp( path.join( os.tmpdir(), 'studio-screenshot-' ) );
}
