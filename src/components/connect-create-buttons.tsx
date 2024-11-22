import { __ } from '@wordpress/i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import Button, { ButtonVariant } from './button';
import offlineIcon from './offline-icon';
import Tooltip from './tooltip';

interface ConnectCreateButtonsProps {
	connectSite: () => void;
	isOffline: boolean;
	connectButtonVariant: ButtonVariant;
	createButtonVariant: ButtonVariant;
	disableConnectButtonStyle?: boolean;
}

export const ConnectCreateButtons = ( {
	connectSite,
	isOffline,
	createButtonVariant,
	connectButtonVariant,
	disableConnectButtonStyle,
}: ConnectCreateButtonsProps ) => {
	const { selectedSite } = useSiteDetails();
	if ( ! selectedSite ) {
		return null;
	}
	return (
		<>
			<Tooltip
				disabled={ ! isOffline }
				text={ __( 'Connecting a site requires an internet connection.' ) }
				icon={ offlineIcon }
				placement="top-start"
			>
				<Button
					onClick={ connectSite }
					disabled={ isOffline }
					aria-disabled={ isOffline }
					variant={ connectButtonVariant }
					className={ cx(
						! disableConnectButtonStyle &&
							! isOffline &&
							'!text-a8c-blueberry !shadow-a8c-blueberry'
					) }
				>
					{ __( 'Connect site' ) }
				</Button>
			</Tooltip>
			<Tooltip
				disabled={ ! isOffline }
				text={ __( 'Creating a site requires an internet connection.' ) }
				icon={ offlineIcon }
				placement="top-start"
			>
				<Button
					onClick={ () => {
						getIpcApi().openURL(
							`https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&studio-site-id=${ selectedSite.id }`
						);
					} }
					variant={ createButtonVariant }
					className={ cx( ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry' ) }
					disabled={ isOffline }
					aria-disabled={ isOffline }
				>
					{ __( 'Create new site' ) }
					<ArrowIcon />
				</Button>
			</Tooltip>
		</>
	);
};
