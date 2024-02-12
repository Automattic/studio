import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export function useContentTabs() {
	const { __ } = useI18n();
	return useMemo(
		() => [
			{
				name: 'preview',
				title: __( 'Preview' ),
			},
			{
				name: 'settings',
				title: __( 'Settings' ),
			},
		],
		[ __ ]
	);
}
