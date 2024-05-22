import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export function useContentTabs() {
	const { __ } = useI18n();
	return useMemo(
		() => [
			{
				name: 'overview',
				title: __( 'Overview' ),
			},
			{
				name: 'share',
				title: __( 'Share' ),
			},
			{
				name: 'settings',
				title: __( 'Settings' ),
			},
			{
				name: 'assistant',
				title: __( 'Assistant' ),
				className: 'components-tab-panel__tabs--assistant pl-8 ml-auto',
			},
		],
		[ __ ]
	);
}
