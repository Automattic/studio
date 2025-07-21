import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { getEnvironmentLabel } from 'src/modules/sync/lib/environment-utils';

export const useSyncDialogTexts = ( type: 'pull' | 'push', envType: string ) => {
	const { __ } = useI18n();

	return useMemo( () => {
		const envLabel = getEnvironmentLabel( envType );

		if ( type === 'pull' ) {
			return {
				/* translators: %s is the environment name (e.g., "Production", "Staging", "Sandbox") */
				title: sprintf( __( 'Pull from %s' ), envLabel ),
				/* translators: %s is the environment type (e.g., "Production", "Staging", "Sandbox") */
				description: sprintf(
					__(
						"Pulling will overwrite your Studio site's selected files and database with a copy from your %s site. Unchecked items will not be changed."
					),
					envType
				),
				fromLabel: __( 'Pull' ),
				subtitleSelector: __( 'What would you like to pull?' ),
				envSync: __( 'Read more about <a>environment pull <ArrowIcon /></a>' ),
				submit: __( 'Pull' ),
			};
		} else {
			return {
				/* translators: %s is the environment name (e.g., "Production", "Staging", "Sandbox") */
				title: sprintf( __( 'Push to %s' ), envLabel ),
				/* translators: first %1s is the environment type, second %2s is the environment type (e.g., "Production", "Staging", "Sandbox") */
				description: sprintf(
					__(
						"Pushing will overwrite your %s site's selected files and database with content from your local site. Unchecked items will not be changed. The %s site will be backed up before any changes are applied."
					),
					envType,
					envType
				),
				fromLabel: __( 'Push' ),
				subtitleSelector: __( 'What would you like to push?' ),
				envSync: __( 'Read more about <a>environment push <ArrowIcon /></a>' ),
				submit: __( 'Push' ),
			};
		}
	}, [ envType, type, __ ] );
};
