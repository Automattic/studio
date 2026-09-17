import { __ } from '@wordpress/i18n';
import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_PLAYGROUND, type SiteRuntime } from '@studio/common/lib/site-runtime';

// Copy for the PHP runtime and file access controls, shared by the agentic UI
// and the Classic renderer so translators only see one phrasing. Kept out of
// `site-runtime.ts` and `site-file-access.ts` so those wire schemas stay free
// of display copy — `cli-events.ts` imports them, and everything parsing a site
// record would otherwise pull @wordpress/i18n along with it. Each one is a
// function so the Classic renderer, which swaps locale data live, re-reads it
// on render.

export function getNativeRuntimeLabel(): string {
	/* translators: PHP runtime option, paired with "Sandbox". The compiled PHP binary that Studio bundles and runs natively on the machine. */
	return __( 'Native' );
}

export function getSandboxRuntimeLabel(): string {
	/* translators: PHP runtime option, paired with "Native". Runs the site in an isolated WordPress Playground sandbox. */
	return __( 'Sandbox' );
}

export function getRuntimeDescription( runtime: SiteRuntime ): string {
	return runtime === SITE_RUNTIME_PLAYGROUND
		? __( 'Runs the site in an isolated WordPress Playground sandbox.' )
		: __( 'Runs the site with native PHP for the best performance.' );
}

export function getSiteDirectoryFileAccessLabel(): string {
	/* translators: File access option, paired with "All files". PHP may only reach the site's own directory. */
	return __( 'Site directory' );
}

export function getAllFilesFileAccessLabel(): string {
	/* translators: File access option, paired with "Site directory". PHP may reach any file on the machine. */
	return __( 'All files' );
}

export function getFileAccessDescription(
	runtime: SiteRuntime,
	fileAccess: SiteFileAccess
): string {
	if ( runtime === SITE_RUNTIME_PLAYGROUND ) {
		return __( 'The sandbox can only access the site directory.' );
	}
	if ( fileAccess === SITE_FILE_ACCESS_ALL_FILES ) {
		return __( 'PHP can access any file on your system.' );
	}
	return __( "Restricts the site's file access to the site directory." );
}

/** Shown when the sandbox runtime holds file access at the site directory. */
export function getFileAccessRequiresNativeLabel(): string {
	return __( 'Requires the Native PHP runtime' );
}
