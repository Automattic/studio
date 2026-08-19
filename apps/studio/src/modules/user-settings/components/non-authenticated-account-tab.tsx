import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { WordPressLogo } from 'src/components/wordpress-logo';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';

export const NonAuthenticatedAccountTab = () => {
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const isOffline = useOffline();
	const offlineMessage = __( "You're currently offline." );

	return (
		<>
			<div className="justify-between items-center w-full h-auto flex">
				<WordPressLogo />
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate( 'settings' );
						} }
					>
						{ __( 'Log in' ) }
					</Button>
				</Tooltip>
			</div>
		</>
	);
};
