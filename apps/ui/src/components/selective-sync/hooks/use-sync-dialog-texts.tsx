import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { EnvironmentType } from '@/components/selective-sync/lib/environment-utils';

type TextByEnvironment = {
	[ key in EnvironmentType ]: {
		title: string;
		description: string;
	};
};

type SyncDialogTexts = {
	title: string;
	description: string;
	subtitleSelector: string;
	envSync: string;
	submit: string;
};

export const useSyncDialogTexts = (
	type: 'pull' | 'push',
	siteEnv: EnvironmentType
): SyncDialogTexts => {
	const { __ } = useI18n();

	return useMemo( () => {
		if ( type === 'pull' ) {
			const textByEnvironment: TextByEnvironment = {
				production: {
					title: __( 'Pull from Production' ),
					description: __(
						"Pulling will overwrite your Studio site's selected files and database with a copy from your production site. Unchecked items will not be changed."
					),
				},
				staging: {
					title: __( 'Pull from Staging' ),
					description: __(
						"Pulling will overwrite your Studio site's selected files and database with a copy from your staging site. Unchecked items will not be changed."
					),
				},
				development: {
					title: __( 'Pull from Development' ),
					description: __(
						"Pulling will overwrite your Studio site's selected files and database with a copy from your development site. Unchecked items will not be changed."
					),
				},
			};
			return {
				title: textByEnvironment[ siteEnv ].title,
				description: textByEnvironment[ siteEnv ].description,
				subtitleSelector: __( 'What would you like to pull?' ),
				envSync: __( 'Read more about <a>environment pull <ArrowIcon /></a>' ),
				submit: __( 'Pull' ),
			};
		} else {
			const textByEnvironment: TextByEnvironment = {
				production: {
					title: __( 'Push to Production' ),
					description: __(
						"Pushing will overwrite your production site's selected files and database with content from your Studio site. Unchecked items will not be changed. The production site will be backed up before any changes are applied."
					),
				},
				staging: {
					title: __( 'Push to Staging' ),
					description: __(
						"Pushing will overwrite your staging site's selected files and database with content from your Studio site. Unchecked items will not be changed. The staging site will be backed up before any changes are applied."
					),
				},
				development: {
					title: __( 'Push to Development' ),
					description: __(
						"Pushing will overwrite your development site's selected files and database with content from your Studio site. Unchecked items will not be changed. The development site will be backed up before any changes are applied."
					),
				},
			};
			return {
				title: textByEnvironment[ siteEnv ].title,
				description: textByEnvironment[ siteEnv ].description,
				subtitleSelector: __( 'What would you like to push?' ),
				envSync: __( 'Read more about <a>environment push <ArrowIcon /></a>' ),
				submit: __( 'Push' ),
			};
		}
	}, [ type, __, siteEnv ] );
};
