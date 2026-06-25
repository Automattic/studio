import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { ActionButton } from 'src/components/action-button';
import { PublishSiteButton } from 'src/components/publish-site-button';
import { Tooltip } from 'src/components/tooltip';
import { useImportExport } from 'src/hooks/use-import-export';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';

export interface SiteManagementActionProps {
	onStop: ( id: string ) => Promise< void >;
	onStart: ( site: SiteDetails ) => Promise< void | { capacityLimitReached: boolean } >;
	selectedSite?: SiteDetails | null;
	loading: boolean;
}

export const SiteManagementActions = ( {
	onStart,
	onStop,
	loading,
	selectedSite,
}: SiteManagementActionProps ) => {
	const { __ } = useI18n();
	const { isSiteImporting } = useImportExport();
	const isPullingLocally = useRootSelector( ( state ) =>
		syncOperationsSelectors.selectIsSiteIdPullingLocally( selectedSite?.id )( state )
	);

	if ( ! selectedSite ) {
		return null;
	}

	const isImporting = isSiteImporting( selectedSite.id );
	const disabled = isImporting || isPullingLocally;

	let buttonLabelOnDisabled: string = __( 'Importing…' );
	if ( isPullingLocally ) {
		buttonLabelOnDisabled = __( 'Pulling…' );
	}

	return (
		<div className="flex gap-2">
			<PublishSiteButton />
			<Tooltip
				disabled={ ! disabled }
				text={ __( "A site can't be stopped or started during import." ) }
				placement="left"
			>
				<ActionButton
					isRunning={ selectedSite.running }
					isLoading={ loading }
					onClick={ () => {
						if ( selectedSite.running ) {
							void onStop( selectedSite.id );
						} else {
							void onStart( selectedSite );
						}
					} }
					disabled={ disabled }
					buttonLabelOnDisabled={ buttonLabelOnDisabled }
				/>
			</Tooltip>
		</div>
	);
};
