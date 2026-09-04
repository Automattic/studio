import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button, { ButtonVariant } from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { cx } from 'src/lib/cx';
import { generateCheckoutUrl } from 'src/lib/generate-checkout-url';
import { getIpcApi } from 'src/lib/get-ipc-api';

interface CreateButtonProps {
	variant: ButtonVariant;
	selectedSite?: SiteDetails;
	text?: string;
	className?: string;
	onClick?: () => void;
}

export const CreateButton = ( {
	variant,
	selectedSite,
	text = __( 'Create new site' ),
	className,
	onClick,
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
					onClick?.();

					// Fires at the handoff to WordPress.com checkout, not at completion —
					// the site coming back is a later `studio_sync_connect` deep link.
					recordRendererTracksEvent( TRACKS_EVENTS.SYNC_CREATE_SITE );
					getIpcApi().openURL( generateCheckoutUrl( selectedSite ) );
				} }
				variant={ variant }
				className={ cx( ! isOffline && className ) }
				disabled={ isOffline }
				aria-disabled={ isOffline }
			>
				{ text }
				<ArrowIcon />
			</Button>
		</Tooltip>
	);
};
