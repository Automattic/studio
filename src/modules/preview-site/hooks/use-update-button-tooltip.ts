import { TooltipProps } from '@wordpress/components/build-types/tooltip/types';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { DEMO_SITE_SIZE_LIMIT_GB } from 'src/constants';
import { useArchiveErrorMessages } from 'src/hooks/use-archive-error-messages';

export function useUpdateButtonTooltip( {
	snapshotCreationBlocked,
	isOverLimit,
}: {
	snapshotCreationBlocked: boolean;
	isOverLimit: boolean;
} ): Partial< TooltipProps > {
	const { __ } = useI18n();
	const errorMessages = useArchiveErrorMessages();
	return useMemo( () => {
		if ( snapshotCreationBlocked ) {
			return { text: errorMessages.rest_site_creation_blocked };
		}

		if ( isOverLimit ) {
			return {
				text: sprintf(
					__(
						'Your site exceeds the %s GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
					),
					DEMO_SITE_SIZE_LIMIT_GB
				),
			};
		}

		return {};
	}, [ snapshotCreationBlocked, isOverLimit, errorMessages.rest_site_creation_blocked, __ ] );
}
