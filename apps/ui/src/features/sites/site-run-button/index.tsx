import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { __ } from '@wordpress/i18n';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStopSite,
} from '@/data/queries/use-sites';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { StartSiteIcon, StopSiteIcon } from '@/lib/icons';
import { IconButton, Spinner } from '@/lib/ui';
import type { SiteDetails } from '@/data/core';

export function SiteRunButton( { site }: { site: SiteDetails } ) {
	const startSite = useStartSiteWithChat();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const starting = useIsSiteStarting( site.id );
	const stopping = useIsSiteStopping( site.id );
	const operation = useSiteOperation( site );
	const label = operation
		? getSiteOperationLabel( operation )
		: stopping
		? __( 'Stopping' )
		: starting
		? __( 'Starting' )
		: site.running
		? __( 'Stop site' )
		: __( 'Start site' );
	return (
		<IconButton
			icon={
				busy ? <Spinner aria-hidden="true" /> : site.running ? <StopSiteIcon /> : <StartSiteIcon />
			}
			label={ label }
			tooltipSide="bottom"
			disabled={ busy }
			aria-busy={ busy || undefined }
			onClick={ () => ( site.running ? stopSite.mutate( site.id ) : startSite.mutate( site.id ) ) }
		/>
	);
}
