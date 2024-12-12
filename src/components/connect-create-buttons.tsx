import { __ } from '@wordpress/i18n';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import Button, { ButtonVariant } from './button';
import offlineIcon from './offline-icon';
import { Tooltip } from './tooltip';

interface ConnectButtonProps {
	connectButtonVariant: ButtonVariant;
	connectSite?: () => void;
	disableConnectButtonStyle?: boolean;
}

interface CreateButtonProps {
	createButtonVariant: ButtonVariant;
	selectedSite: SiteDetails;
	createButtonText?: string;
}

export const ConnectButton = ( {
	connectButtonVariant,
	connectSite,
	disableConnectButtonStyle,
}: ConnectButtonProps ) => {
	const isOffline = useOffline();
	return (
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
					! disableConnectButtonStyle && ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry'
				) }
			>
				{ __( 'Connect site' ) }
			</Button>
		</Tooltip>
	);
};

export const CreateButton = ( {
	createButtonVariant,
	selectedSite,
	createButtonText = __( 'Create new site' ),
}: CreateButtonProps ) => {
	const isOffline = useOffline();
	return (
		<Tooltip
			disabled={ ! isOffline }
			text={ __( 'Creating a site requires an internet connection.' ) }
			icon={ offlineIcon }
			placement="top-start"
		>
			<Button
				onClick={ () => {
					getIpcApi().openURL(
						`https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&studioSiteId=${ selectedSite.id }`
					);
				} }
				variant={ createButtonVariant }
				className={ cx( ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry' ) }
				disabled={ isOffline }
				aria-disabled={ isOffline }
			>
				{ createButtonText }
				<ArrowIcon />
			</Button>
		</Tooltip>
	);
};
