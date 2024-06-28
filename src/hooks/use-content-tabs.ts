import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { useFeatureFlags } from './use-feature-flags';

export function useContentTabs() {
	const { __ } = useI18n();
	const { assistantEnabled } = useFeatureFlags();

	return useMemo( () => {
		const tabs: React.ComponentProps< typeof TabPanel >[ 'tabs' ] = [
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
		];

		if ( assistantEnabled ) {
			tabs.push( {
				name: 'assistant',
				title: __( 'Assistant' ),
				className:
					'components-tab-panel__tabs--assistant ltr:pl-8 rtl:pr-8 ltr:ml-auto rtl:mr-auto',
			} );
		}

		return tabs;
	}, [ __, assistantEnabled ] );
}
