import { __ } from '@wordpress/i18n';
import { ReactElement } from 'react';
import Button, { ButtonVariant } from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';

interface ConnectButtonProps {
	variant: ButtonVariant;
	icon?: ReactElement;
	connectSite?: () => void;
	disabled?: boolean;
	className?: string;
	children?: React.ReactNode;
	tooltipText?: string;
	isBusy?: boolean;
}

export const ConnectButton = ( {
	variant,
	icon,
	connectSite,
	disabled,
	className,
	children,
	tooltipText,
	isBusy = false,
}: ConnectButtonProps ) => {
	const isOffline = useOffline();
	const tooltipContent = tooltipText ?? __( 'Connecting a site requires an internet connection.' );
	const isDisabled = disabled || isOffline;
	const shouldShowTooltip = isDisabled && ! isBusy;
	return (
		<Tooltip
			disabled={ ! shouldShowTooltip }
			text={ tooltipContent }
			icon={ offlineIcon }
			placement="top-start"
		>
			<Button
				onClick={ connectSite }
				disabled={ isDisabled }
				aria-disabled={ isDisabled }
				variant={ variant }
				icon={ icon }
				className={ className }
				isBusy={ isBusy }
			>
				{ children }
			</Button>
		</Tooltip>
	);
};
