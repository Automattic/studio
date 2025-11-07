import { __ } from '@wordpress/i18n';
import Button, { ButtonVariant } from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';

interface ConnectButtonProps {
	variant: ButtonVariant;
	connectSite?: () => void;
	disableConnectButtonStyle?: boolean;
	className?: string;
	children?: React.ReactNode;
	isBusy?: boolean;
}

export const ConnectButton = ( {
	variant,
	connectSite,
	disableConnectButtonStyle,
	className,
	children,
	isBusy = false,
}: ConnectButtonProps ) => {
	const isOffline = useOffline();
	const isDisabled = isOffline || isBusy;
	return (
		<Tooltip
			disabled={ ! isOffline }
			text={ __( 'Connecting a site requires an internet connection.' ) }
			icon={ offlineIcon }
			placement="top-start"
		>
			<Button
				onClick={ connectSite }
				disabled={ isDisabled }
				aria-disabled={ isDisabled }
				variant={ variant }
				isBusy={ isBusy }
				className={ cx(
					! disableConnectButtonStyle && ! isOffline && '!text-a8c-blue-50 !shadow-a8c-blue-50',
					className
				) }
			>
				{ children }
			</Button>
		</Tooltip>
	);
};
