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
				name: 'launchpad',
				title: __( 'Launchpad' ),
			},
			{
				name: 'publish',
				title: __( 'Publish' ),
			},
			{
				name: 'export',
				title: __( 'Export' ),
			},
			{
				name: 'settings',
				title: __( 'Settings' ),
			},
		],
		[]
	);
}
