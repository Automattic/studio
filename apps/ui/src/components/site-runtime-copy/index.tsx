import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_PLAYGROUND, type SiteRuntime } from '@studio/common/lib/site-runtime';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { LearnMoreLink } from '@/components/learn-more';

export function RuntimeDescription( {
	runtime,
	learnMoreLink,
}: {
	runtime: SiteRuntime;
	learnMoreLink?: boolean;
} ) {
	if ( learnMoreLink ) {
		return createInterpolateElement(
			runtime === SITE_RUNTIME_PLAYGROUND
				? __( 'Runs the site in an isolated WordPress Playground sandbox. <learn_more_link />' )
				: __( 'Runs the site with native PHP for the best performance. <learn_more_link />' ),
			{
				learn_more_link: <LearnMoreLink docsLinksKey="docsPhpRuntimes" />,
			}
		);
	}

	return runtime === SITE_RUNTIME_PLAYGROUND
		? __( 'Runs the site in an isolated WordPress Playground sandbox.' )
		: __( 'Runs the site with native PHP for the best performance.' );
}

export function FileAccessDescription( {
	runtime,
	fileAccess,
}: {
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
} ) {
	if ( runtime === SITE_RUNTIME_PLAYGROUND ) {
		return __( 'The sandbox can only access the site directory.' );
	}
	if ( fileAccess === SITE_FILE_ACCESS_ALL_FILES ) {
		return __( 'PHP can access any file on your system.' );
	}
	return __( "Restricts the site's file access to the site directory." );
}
