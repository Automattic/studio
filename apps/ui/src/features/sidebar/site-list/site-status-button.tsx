import { __, sprintf } from '@wordpress/i18n';
import { useIsSiteBusy, useSiteOperation, useStopSite } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { PlayIcon, SquareIcon } from '@/lib/icons';
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
	const siteBusy = useIsSiteBusy( site );
	const activity = useSiteSyncActivity( site.id );
	const isSyncPending = activity?.kind === 'pending' && activity.direction !== 'preview';
	const busy = siteBusy || isSyncPending;
	const operation = useSiteOperation( site );
	const visuallyStopped = isStopping || operation === 'stop';
	const visualBusy = isSyncPending || ( siteBusy && ! visuallyStopped );
	const visualRunning = !! site.running && ! visuallyStopped;
	const status = getSiteStatus( site, isStarting, isStopping, operation );
	const statusName = isSyncPending
		? activity.direction === 'import'
			? __( 'Importing backup' )
			: __( 'Syncing live site' )
		: getSiteStatusName( {
				running: site.running,
				starting: isStarting,
				stopping: isStopping,
				operation,
		  } );
	const label = sprintf( visualRunning ? __( 'Stop %s' ) : __( 'Start %s' ), site.name );
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
						aria-label={ visualBusy ? statusName : label }
						aria-busy={ visualBusy || undefined }
						disabled={ busy }
						focusableWhenDisabled
						data-state={ visuallyStopped ? 'stopped' : status }
						onClick={ handleClick }
					>
						{ visualBusy ? (
							<Spinner aria-hidden="true" />
						) : visualRunning ? (
							<SquareIcon />
						) : (
							<PlayIcon />
						) }
					</Button>
				}
			/>
			<TooltipContent>
				{ visualBusy ? statusName : visualRunning ? __( 'Stop site' ) : __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
