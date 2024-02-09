import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export function useContentTabs() {
	const { __ } = useI18n();
	return useMemo(
		() => [
			{
				name: 'snapshots',
				title: __( 'Snapshots' ),
			},
			{
				name: 'settings',
				title: __( 'Settings' ),
			},
		],
		[ __ ]
	);
}
