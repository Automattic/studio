import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';
import { getAppGlobals } from '../lib/app-globals';

export function useContentTabs() {
	const { __ } = useI18n();

	const assistantEnabled = getAppGlobals().assistantEnabled;

	return useMemo( () => {
		const tabs = [
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
			} as { name: string; title: string; className: string } );
		}

		return tabs;
	}, [ __, assistantEnabled ] );
}
