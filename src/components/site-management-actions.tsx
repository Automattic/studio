import { ActionButton } from './action-button';

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
	return selectedSite ? (
		<ActionButton
			isRunning={ selectedSite.running }
			isLoading={ loading }
			onClick={ () => {
				selectedSite.running ? onStop( selectedSite.id ) : onStart( selectedSite.id );
			} }
		/>
	) : null;
};
