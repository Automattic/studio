import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { StartSiteIcon } from '@/lib/icons/start-site-icon';
import { StopSiteIcon } from '@/lib/icons/stop-site-icon';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

/**
 * Starts or stops the site from a header: labeled while stopped, an icon once
 * running, or whenever the header is `compact`.
 */
export function SiteLifecycleButton( {
	site,
	compact = false,
}: {
	site: SiteDetails;
	compact?: boolean;
} ) {
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isBusy = useIsSiteBusy( site );
	const running = site.running || isStopping;
	const label = isStarting
		? __( 'Starting' )
		: isStopping
		? __( 'Stopping' )
		: running
		? __( 'Stop' )
		: __( 'Start' );
	const pending = isStarting || isStopping;
	const iconOnly = running || compact;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant={ running ? 'outline' : 'default' }
						size={ iconOnly ? 'icon' : 'default' }
						disabled={ isBusy }
						loading={ pending }
						onClick={ () => ( running ? stopSite : startSite ).mutate( site.id ) }
					>
						{ pending ? null : running ? (
							<StopSiteIcon data-icon="inline-start" />
						) : (
							<StartSiteIcon data-icon="inline-start" />
						) }
						<span className={ iconOnly ? styles.visuallyHidden : undefined }>{ label }</span>
					</Button>
				}
			/>
			<TooltipContent side="bottom">
				{ running ? __( 'Stop site' ) : __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
