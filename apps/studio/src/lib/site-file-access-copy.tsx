import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { useI18n } from '@wordpress/react-i18n';

// Explainer copy shown under the File access control in the create/edit site
// forms and in the read-only site settings.
export function FileAccessDescription( { fileAccess }: { fileAccess: SiteFileAccess } ) {
	const { __ } = useI18n();
	if ( fileAccess === SITE_FILE_ACCESS_ALL_FILES ) {
		return <>{ __( 'PHP can access any file on your system.' ) }</>;
	}
	return <>{ __( "Restricts the site's file access to the site directory." ) }</>;
}
