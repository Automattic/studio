import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_PLAYGROUND, type SiteRuntime } from '@studio/common/lib/site-runtime';
import { useI18n } from '@wordpress/react-i18n';

// Explainer copy shown under the PHP runtime control in the create/edit site
// forms and in the read-only site settings.
export function RuntimeDescription( { runtime }: { runtime: SiteRuntime } ) {
	const { __ } = useI18n();
	return (
		<>
			{ runtime === SITE_RUNTIME_PLAYGROUND
				? __( 'Runs the site in an isolated WordPress Playground sandbox.' )
				: __( 'Runs the site with native PHP for the best performance.' ) }
		</>
	);
}

// Explainer copy shown under the File access control in the create/edit site
// forms and in the read-only site settings.
export function FileAccessDescription( {
	runtime,
	fileAccess,
}: {
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
} ) {
	const { __ } = useI18n();
	if ( runtime === SITE_RUNTIME_PLAYGROUND ) {
		return <>{ __( 'The sandbox can only access the site directory.' ) }</>;
	}
	if ( fileAccess === SITE_FILE_ACCESS_ALL_FILES ) {
		return <>{ __( 'PHP can access any file on your system.' ) }</>;
	}
	return <>{ __( "Restricts the site's file access to the site directory." ) }</>;
}
