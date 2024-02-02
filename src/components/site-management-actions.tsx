import { useState } from 'react';
import { useI18n } from '@wordpress/react-i18n';
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
	const { __ } = useI18n();
	const [ isHovered, setIsHovered ] = useState( false );

	let controlText = __( 'Start' );
	if ( loading ) {
		controlText = __( 'Starting...' );
	} else if ( selectedSite?.running ) {
		controlText = isHovered ? __( 'Stop' ) : __( 'Running' );
	}

	return selectedSite ? (
		<div
			className="flex min-w-24"
			onMouseEnter={ () => setIsHovered( true ) }
			onMouseLeave={ () => setIsHovered( false ) }
		>
			<ActionButton
				isHovered={ isHovered }
				running={ selectedSite.running }
				isLoading={ loading }
				className="!grow !justify-center !leading-4"
				iconSize={ 10 }
				onClick={ () =>
					selectedSite.running ? onStop( selectedSite.id ) : onStart( selectedSite.id )
				}
			>
				{ controlText }
			</ActionButton>
		</div>
	) : null;
};
