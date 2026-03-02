import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { MIN_WIDTH_CLASS_TO_MEASURE } from 'src/constants';
import { VipContentTabImportExport } from './vip-content-tab-import-export';
import { VipContentTabOverview } from './vip-content-tab-overview';
import { VipContentTabSettings } from './vip-content-tab-settings';
import { VipContentTabSync } from './vip-content-tab-sync';
import { useVipContext } from './vip-context';
import { VipHeader } from './vip-header';

type VipTabName = 'overview' | 'sync' | 'import-export' | 'settings';

export function VipContentTabs() {
	const { __ } = useI18n();
	const { selectedEnvironment } = useVipContext();
	const [ selectedTab, setSelectedTab ] = useState< VipTabName >( 'overview' );

	const tabs = [
		{ name: 'overview' as const, title: __( 'Overview' ) },
		{ name: 'sync' as const, title: __( 'Sync' ) },
		{ name: 'import-export' as const, title: __( 'Import / Export' ) },
		{ name: 'settings' as const, title: __( 'Settings' ) },
	];

	if ( ! selectedEnvironment ) {
		return (
			<div className="w-full h-full flex items-center justify-center app-no-drag-region">
				<p className="text-lg text-gray-600">{ __( 'Select a site to view details.' ) }</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<VipHeader />
			<TabPanel
				className={ `mt-6 h-full flex flex-col overflow-hidden ${ MIN_WIDTH_CLASS_TO_MEASURE }` }
				tabs={ tabs }
				orientation="horizontal"
				onSelect={ ( tabName ) => {
					setSelectedTab( tabName as VipTabName );
				} }
				initialTabName={ selectedTab }
				key={ selectedEnvironment.slug }
			>
				{ ( { name } ) => (
					<div
						className="h-full overflow-y-auto"
						style={ {
							scrollbarWidth: 'thin',
							scrollbarGutter: 'stable',
						} }
					>
						{ name === 'overview' && (
							<VipContentTabOverview selectedEnvironment={ selectedEnvironment } />
						) }
						{ name === 'sync' && <VipContentTabSync selectedEnvironment={ selectedEnvironment } /> }
						{ name === 'import-export' && (
							<VipContentTabImportExport selectedEnvironment={ selectedEnvironment } />
						) }
						{ name === 'settings' && (
							<VipContentTabSettings selectedEnvironment={ selectedEnvironment } />
						) }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
