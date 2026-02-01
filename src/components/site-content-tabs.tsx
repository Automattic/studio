import { useI18n } from '@wordpress/react-i18n';
import { AssistantIcon } from 'src/components/assistant-icon';
import { ContentTabAssistant } from 'src/components/content-tab-assistant';
import { ContentTabImportExport } from 'src/components/content-tab-import-export';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabPreviews } from 'src/components/content-tab-previews';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import Header from 'src/components/header';
import { SiteIsBeingCreated } from 'src/components/site-is-being-created';
import { MIN_WIDTH_CLASS_TO_MEASURE } from 'src/constants';
import { useEffectiveTab } from 'src/hooks/use-effective-tab';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { ContentTabSync } from 'src/modules/sync';

export function SiteContentTabs() {
	const { selectedSite, siteCreationMessages } = useSiteDetails();
	const { importState } = useImportExport();
	const { effectiveTab, setSelectedTab, tabs } = useEffectiveTab();
	const { __ } = useI18n();

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

	const isAssistantActive = effectiveTab === 'assistant';

	const handleAssistantClick = () => {
		setSelectedTab( 'assistant' );
	};


	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<Header />
			<div className={ `mt-6 h-full flex flex-col overflow-hidden ${ MIN_WIDTH_CLASS_TO_MEASURE }` }>
				{ /* Tab bar with scrollable tabs + fixed assistant button */ }
				<div className="site-tabs-bar">
					<div className="site-tabs-scrollable">
						{ tabs.map( ( tab ) => (
							<button
								key={ tab.name }
								type="button"
								role="tab"
								aria-selected={ effectiveTab === tab.name }
								className={ cx(
									'site-tab-button',
									effectiveTab === tab.name && 'is-active'
								) }
								onClick={ () => setSelectedTab( tab.name ) }
							>
								{ tab.title }
							</button>
						) ) }
					</div>
					<button
						type="button"
						role="tab"
						aria-selected={ isAssistantActive }
						className={ cx(
							'site-tab-button site-tab-assistant',
							isAssistantActive && 'is-active'
						) }
						onClick={ handleAssistantClick }
					>
						<AssistantIcon />
						{ __( 'Assistant' ) }
					</button>
				</div>
				{ /* Tab content */ }
				<div
					className={ cx(
						'h-full overflow-y-auto flex-1',
						isAssistantActive && 'bg-gray-50'
					) }
					style={ {
						scrollbarWidth: 'thin',
						scrollbarGutter: 'stable',
					} }
				>
					{ effectiveTab === 'overview' && <ContentTabOverview selectedSite={ selectedSite } /> }
					{ effectiveTab === 'previews' && <ContentTabPreviews selectedSite={ selectedSite } /> }
					{ effectiveTab === 'sync' && <ContentTabSync selectedSite={ selectedSite } /> }
					{ effectiveTab === 'settings' && <ContentTabSettings selectedSite={ selectedSite } /> }
					{ effectiveTab === 'assistant' && <ContentTabAssistant selectedSite={ selectedSite } /> }
					{ effectiveTab === 'import-export' && (
						<ContentTabImportExport selectedSite={ selectedSite } />
					) }
				</div>
			</div>
		</div>
	);
}
