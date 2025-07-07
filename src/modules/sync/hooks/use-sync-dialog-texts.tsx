import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export const useSyncDialogTexts = ( type: 'pull' | 'push' ) => {
	const { __ } = useI18n();

	return useMemo( () => {
		if ( type === 'pull' ) {
			return {
				staging: {
					title: __( 'Pull from Staging' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your staging site."
					),
				},
				sandbox: {
					title: __( 'Pull from Sandbox' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your sandbox site."
					),
				},
				production: {
					title: __( 'Pull from Production' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your production site."
					),
				},
				fromLabel: __( 'Pull' ),
				toLabel: __( 'To' ),
				subtitleSelector: __( 'What would you like to pull?' ),
				envSync: __( 'Read more about <a>environment pull <ArrowIcon /></a>' ),
				submit: __( 'Pull' ),
			};
		} else {
			return {
				staging: {
					title: __( 'Push to Staging' ),
					description: __(
						'Pushing synchronizes your local site with the staging site. You can push everything or select specific parts. Unchecked items will not be changed. A backup of the staging site is created before applying changes.'
					),
				},
				sandbox: {
					title: __( 'Push to Sandbox' ),
					description: __(
						'Pushing synchronizes your local site with the sandbox site. You can push everything or select specific parts. Unchecked items will not be changed. A backup of the sandbox site is created before applying changes.'
					),
				},
				production: {
					title: __( 'Push to Production' ),
					description: __(
						'Pushing synchronizes your local site with the production site. You can push everything or select specific parts. Unchecked items will not be changed. A backup of the production site is created before applying changes.'
					),
				},
				fromLabel: __( 'Push' ),
				toLabel: __( 'To' ),
				subtitleSelector: __( 'What would you like to push?' ),
				envSync: __( 'Read more about <a>environment push <ArrowIcon /></a>' ),
				submit: __( 'Push' ),
			};
		}
	}, [ type, __ ] );
};
