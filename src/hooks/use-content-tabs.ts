import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { useFeatureFlags } from './use-feature-flags';

export function useContentTabs() {
	const { __ } = useI18n();
	const { assistantEnabled, importExportEnabled } = useFeatureFlags();

	return useMemo( () => {
		const tabs: React.ComponentProps< typeof TabPanel >[ 'tabs' ] = [
			{
				order: 1,
				name: 'overview',
				title: __( 'Overview' ),
			},
			{
				order: 2,
				name: 'share',
				title: __( 'Share' ),
			},
			{
				order: 4,
				name: 'settings',
				title: __( 'Settings' ),
			},
		];

		if ( importExportEnabled ) {
			tabs.push( {
				order: 3,
				name: 'import-export',
				title: __( 'Import / Export' ),
			} );
		}

		if ( assistantEnabled ) {
			tabs.push( {
				order: 5,
				name: 'assistant',
				title: __( 'Assistant' ),
				className:
					'components-tab-panel__tabs--assistant ltr:pl-8 rtl:pr-8 ltr:ml-auto rtl:mr-auto',
			} );
		}

		return tabs.sort( ( a, b ) => a.order - b.order );
	}, [ __, assistantEnabled, importExportEnabled ] );
}
