import { __ } from '@wordpress/i18n';
import { DEFAULT_CUSTOM_DOMAIN_SUFFIX } from 'common/constants';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button, { ButtonVariant } from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
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
	function generateCheckoutUrl( selectedSite?: SiteDetails ): string {
		const url = new URL(
			'https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&showDomainStep'
		);

		if ( ! selectedSite ) {
			return url.toString();
		}

		const suggestedName = selectedSite.customDomain
			? selectedSite.customDomain.replace( DEFAULT_CUSTOM_DOMAIN_SUFFIX, '' )
			: selectedSite.name;

		url.searchParams.set( 'studioSiteId', String( selectedSite.id ) );
		url.searchParams.set( 'new', suggestedName );

		return url.toString();
	}

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
