import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useSyncSites } from '../hooks/sync-sites';
import { useImportExport } from '../hooks/use-import-export';
import { ActionButton } from './action-button';
import { Tooltip } from './tooltip';

export interface SiteManagementActionProps {
	onStop: ( id: string ) => Promise< void >;
	onStart: ( id: string ) => void;
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
	const { isSiteIdPulling } = useSyncSites();
	if ( ! selectedSite ) {
		return null;
	}

	const isImporting = isSiteImporting( selectedSite.id );
	const isPulling = isSiteIdPulling( selectedSite.id );
	const disabled = isImporting || isPulling;

	let buttonLabelOnDisabled = __( 'Importing…' );
	if ( isPulling ) {
		buttonLabelOnDisabled = __( 'Pulling…' );
	}

	return (
		<Tooltip
			disabled={ ! disabled }
			text={ __( "A site can't be stopped or started during import." ) }
			placement="left"
		>
			<ActionButton
				isRunning={ selectedSite.running }
				isLoading={ loading }
				onClick={ () => {
					selectedSite.running ? onStop( selectedSite.id ) : onStart( selectedSite.id );
				} }
				disabled={ disabled }
				buttonLabelOnDisabled={ buttonLabelOnDisabled }
			/>
		</Tooltip>
	);
};
