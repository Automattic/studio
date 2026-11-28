import { Button, Spinner, Tooltip, TooltipContent, TooltipTrigger } from '@studio/ds';
import { PlayIcon, SquareIcon } from '@studio/ds/icons';
import { __, sprintf } from '@wordpress/i18n';
import { useStopSite } from '@/data/queries/use-sites';
import { useSiteLifecycleState } from '@/data/use-site-lifecycle-state';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
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
	const {
		activity,
		isSyncPending,
		operation,
		stoppingStart,
		canStopStart,
		visuallyStopped,
		visualBusy,
		visualRunning,
		disabled,
	} = useSiteLifecycleState( site, isStarting, isStopping );
	const status = getSiteStatus( site, isStarting, isStopping, operation );
	const statusName = isSyncPending
		? activity?.direction === 'import'
			? __( 'Importing backup' )
			: __( 'Syncing live site' )
		: stoppingStart
		? __( 'Stopping' )
		: getSiteStatusName( {
				running: site.running,
				starting: isStarting,
				stopping: isStopping,
				operation,
		  } );
	const label = sprintf(
		visualRunning || canStopStart ? __( 'Stop %s' ) : __( 'Start %s' ),
		site.name
	);
	const handleClick = () => {
		if ( site.running || canStopStart ) {
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
						className={ styles.statusButton }
						variant="muted-ghost"
						size="icon-sm"
						aria-label={ visualBusy && ! canStopStart ? statusName : label }
						aria-busy={ visualBusy || undefined }
						disabled={ disabled }
						focusableWhenDisabled
						data-state={ visuallyStopped ? 'stopped' : status }
						onClick={ handleClick }
					>
						{ visualBusy ? (
							<>
								<Spinner
									aria-hidden="true"
									className={ canStopStart ? styles.startSpinner : undefined }
								/>
								{ canStopStart && <SquareIcon className={ styles.cancelStartIcon } /> }
							</>
						) : visualRunning ? (
							<SquareIcon />
						) : (
							<PlayIcon />
						) }
					</Button>
				}
			/>
			<TooltipContent>
				{ visualBusy && ! canStopStart
					? statusName
					: visualRunning || canStopStart
					? __( 'Stop site' )
					: __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
