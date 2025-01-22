import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { DEMO_SITE_SIZE_LIMIT_GB } from '../constants';

export function useArchiveErrorMessages() {
	const { __ } = useI18n();

	return useMemo(
		() =>
			( {
				rest_site_limit_reached: __( 'Demo sites limit reached. Please, delete some demo sites.' ),
				no_file: __( "We didn't receive the zip file. Please try uploading it again." ),
				invalid_file_size: sprintf(
					__( 'The file size exceeds the limit of %d GB. Please try reducing the site size.' ),
					DEMO_SITE_SIZE_LIMIT_GB
				),
				could_not_upload: __( 'There was an issue uploading the zip file.' ),
				rest_cannot_view: __(
					"There's been an authentication error. Please log in again before sharing a site."
				),
				rest_site_creation_blocked: __( 'Demo sites are not available for your account.' ),
			} ) as const,
		[ __ ]
	);
}
