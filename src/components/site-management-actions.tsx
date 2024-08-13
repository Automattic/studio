import { __ } from '@wordpress/i18n';
import { useImportExport } from '../hooks/use-import-export';
import { ActionButton } from './action-button';
import Tooltip from './tooltip';

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
	const { isSiteImporting } = useImportExport();

	if ( ! selectedSite ) {
		return null;
	}

	const isImporting = isSiteImporting( selectedSite.id );

	return (
		<Tooltip
			disabled={ ! isImporting }
			text={ __( "A site can't be stopped or started during import." ) }
			placement="left"
		>
			<ActionButton
				isRunning={ selectedSite.running }
				isLoading={ loading }
				onClick={ () => {
					selectedSite.running ? onStop( selectedSite.id ) : onStart( selectedSite.id );
				} }
				isImporting={ isImporting }
			/>
		</Tooltip>
	);
};
