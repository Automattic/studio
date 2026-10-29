import { __, sprintf } from '@wordpress/i18n';
import { useIsSiteBusy, useSiteOperation, useStopSite } from '@/data/queries/use-sites';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { StartSiteIcon, StopSiteIcon } from '@/lib/icons';
import { Button, Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import { getSiteStatus, getSiteStatusName } from './site-status';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function SiteStatusButton( {
	site,
	isStarting,
	isStopping,
	onStart,
}: {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
	onStart?: () => void;
} ) {
	const startSite = useStartSiteWithChat();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const status = getSiteStatus( site, isStarting, isStopping, operation );
	// The recorded operation wins: it names work this window didn't start (an
	// agent restart, another Studio window) that local start/stop state can't see.
	const statusName = getSiteStatusName( {
		running: site.running,
		starting: isStarting,
		stopping: isStopping,
		operation,
	} );
	const label = sprintf( site.running ? __( 'Stop %s' ) : __( 'Start %s' ), site.name );
	const handleClick = () => {
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
			onStart?.();
		}
	};

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						className={ styles.rowAction }
						variant="muted-ghost"
						size="icon-sm"
						aria-label={ busy ? statusName : label }
						aria-busy={ busy || undefined }
						disabled={ busy }
						focusableWhenDisabled
						data-state={ status }
						onClick={ handleClick }
					>
						{ busy ? (
							<Spinner aria-hidden="true" />
						) : site.running ? (
							<StopSiteIcon />
						) : (
							<StartSiteIcon />
						) }
					</Button>
				}
			/>
			<TooltipContent>
				{ busy ? statusName : site.running ? __( 'Stop site' ) : __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
