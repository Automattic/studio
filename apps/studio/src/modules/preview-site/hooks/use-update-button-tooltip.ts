import { TooltipProps } from '@wordpress/components/build-types/tooltip/types';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import offlineIcon from 'src/components/offline-icon';

export function useUpdateButtonTooltip( {
	snapshotCreationBlocked,
	isOverLimit,
	isOffline,
}: {
	snapshotCreationBlocked: boolean;
	isOverLimit: boolean;
	isOffline: boolean;
} ): Pick< TooltipProps, 'text' > {
	const { __ } = useI18n();

	return useMemo( () => {
		if ( snapshotCreationBlocked ) {
			return { text: __( 'Preview sites are not available for your account.' ) };
		}

		if ( isOffline ) {
			return {
				text: __( 'Updating a preview site requires an internet connection.' ),
				icon: offlineIcon,
			};
		}

		if ( isOverLimit ) {
			return {
				text: sprintf(
					__(
						'Your site exceeds the %d GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
					),
					DEMO_SITE_SIZE_LIMIT_GB
				),
			};
		}

		return {};
	}, [ snapshotCreationBlocked, isOffline, isOverLimit, __ ] );
}
