import { TabPanel } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef, useState } from 'react';
import { ContentTabAssistant } from 'src/components/content-tab-assistant';
import { ContentTabImportExport } from 'src/components/content-tab-import-export';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabPreviews } from 'src/components/content-tab-previews';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { EmptyStudio } from 'src/components/empty-studio';
import Header from 'src/components/header';
import { SiteIsBeingCreated } from 'src/components/site-is-being-created';
import { MIN_WIDTH_CLASS_TO_MEASURE } from 'src/constants';
import { TabName, useContentTabs } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { ContentTabSync } from 'src/modules/sync';

export function SiteContentTabs() {
	const { selectedSite, data: localSites, siteCreationMessages } = useSiteDetails();
	const { importState } = useImportExport();
	const { tabs, selectedTab, setSelectedTab } = useContentTabs();
	const { __ } = useI18n();

	// Remount: Avoid focus loss on user tab changes (no remount),
	// but remount on programmatic changes and site switches so initial tab/content state resets.
	const [ keyCounter, setKeyCounter ] = useState( 0 );
	const lastChangeWasUser = useRef( false );
	const isFirstRender = useRef( true );

	useEffect( () => {
		if ( isFirstRender.current ) {
			isFirstRender.current = false;
			return;
		}
		if ( lastChangeWasUser.current ) {
			lastChangeWasUser.current = false;
			return;
		}
		setKeyCounter( ( k ) => k + 1 );
	}, [ selectedTab ] );

	if ( ! localSites.length ) {
		return <EmptyStudio />;
	}

	if ( ! selectedSite ) {
		return (
			<div className="w-full h-full flex items-center justify-center app-no-drag-region">
				<p className="text-lg text-gray-600">{ __( 'Select a site to view details.' ) }</p>
			</div>
		);
	}

	if ( selectedSite?.isAddingSite || importState[ selectedSite?.id ]?.isNewSite ) {
		const siteImportState = importState[ selectedSite?.id ];
		const creationMessage = selectedSite?.id ? siteCreationMessages[ selectedSite.id ] : undefined;
		return (
			<SiteIsBeingCreated
				siteName={ selectedSite?.name }
				statusMessage={ siteImportState?.statusMessage || creationMessage }
			/>
		);
	}

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<Header />
			<TabPanel
				className={ `mt-6 h-full flex flex-col overflow-hidden ${ MIN_WIDTH_CLASS_TO_MEASURE }` }
				tabs={ tabs }
				orientation="horizontal"
				onSelect={ ( tabName ) => {
					// Mark this as a user-initiated change so we don't remount
					lastChangeWasUser.current = true;
					setSelectedTab( tabName as TabName );
				} }
				initialTabName={ selectedTab }
				key={ `${ selectedSite.id }-${ keyCounter }` }
			>
				{ ( { name } ) => (
					<div
						className={ cx(
							'h-full overflow-y-auto',
							selectedTab === 'assistant' && 'bg-gray-50'
						) }
						style={ {
							scrollbarWidth: 'thin',
							scrollbarGutter: 'stable',
						} }
					>
						{ name === 'overview' && <ContentTabOverview selectedSite={ selectedSite } /> }
						{ name === 'previews' && <ContentTabPreviews selectedSite={ selectedSite } /> }
						{ name === 'sync' && <ContentTabSync selectedSite={ selectedSite } /> }
						{ name === 'settings' && <ContentTabSettings selectedSite={ selectedSite } /> }
						{ name === 'assistant' && <ContentTabAssistant selectedSite={ selectedSite } /> }
						{ name === 'import-export' && <ContentTabImportExport selectedSite={ selectedSite } /> }
					</div>
				) }
			</TabPanel>
		</div>
	);
}
