import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_PLAYGROUND, type SiteRuntime } from '@studio/common/lib/site-runtime';

type Translate = ( text: string ) => string;

// Explainer copy shown under the File access control in the create/edit site
// forms. Takes the component's translate fn so the strings resolve against the
// active locale (and stay extractable for translation).
export function getFileAccessDescription(
	__: Translate,
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
