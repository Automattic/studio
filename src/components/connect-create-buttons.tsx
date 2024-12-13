import { __ } from '@wordpress/i18n';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import Button, { ButtonVariant } from './button';
import offlineIcon from './offline-icon';
import { Tooltip } from './tooltip';

interface ConnectButtonProps {
	variant: ButtonVariant;
	connectSite?: () => void;
	disableConnectButtonStyle?: boolean;
	className?: string;
}

interface CreateButtonProps {
	variant: ButtonVariant;
	selectedSite: SiteDetails;
	text?: string;
	className?: string;
}

export const ConnectButton = ( {
	variant,
	connectSite,
	disableConnectButtonStyle,
	className,
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
				variant={ variant }
				className={ cx(
					! disableConnectButtonStyle && ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry',
					className
				) }
			>
				{ __( 'Connect site' ) }
			</Button>
		</Tooltip>
	);
};

export const CreateButton = ( {
	variant,
	selectedSite,
	text = __( 'Create new site' ),
	className,
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
				variant={ variant }
				className={ cx( ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry', className ) }
				disabled={ isOffline }
				aria-disabled={ isOffline }
			>
				{ text }
				<ArrowIcon />
			</Button>
		</Tooltip>
	);
};
