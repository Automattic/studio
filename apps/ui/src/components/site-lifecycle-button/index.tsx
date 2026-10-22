import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { startSiteIcon, stopSiteIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

/** Starts or stops the site from a header: labeled while stopped, an icon once running. */
export function SiteLifecycleButton( { site }: { site: SiteDetails } ) {
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
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant={ running ? 'outline' : 'default' }
						size={ running ? 'icon' : 'default' }
						disabled={ isBusy }
						loading={ pending }
						onClick={ () => ( running ? stopSite : startSite ).mutate( site.id ) }
					>
						{ ! pending && (
							<Icon icon={ running ? stopSiteIcon : startSiteIcon } data-icon="inline-start" />
						) }
						<span className={ running ? styles.visuallyHidden : styles.label }>{ label }</span>
					</Button>
				}
			/>
			<TooltipContent side="bottom">
				{ running ? __( 'Stop site' ) : __( 'Start site' ) }
			</TooltipContent>
		</Tooltip>
	);
}
