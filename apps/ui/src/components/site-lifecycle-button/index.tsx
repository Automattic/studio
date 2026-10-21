import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { Button, Spinner, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
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
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<Button
						variant={ running ? 'outline' : 'solid' }
						tone="neutral"
						size="small"
						className={ clsx( 'studio-control', running && styles.iconOnly ) }
						disabled={ isBusy }
						aria-busy={ isStarting || isStopping }
						onClick={ () => ( running ? stopSite : startSite ).mutate( site.id ) }
					>
						{ isStarting || isStopping ? (
							<Spinner />
						) : (
							<Icon icon={ running ? stopSiteIcon : startSiteIcon } size={ 16 } />
						) }
						<span className={ running ? styles.visuallyHidden : styles.label }>{ label }</span>
					</Button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
				{ running ? __( 'Stop site' ) : __( 'Start site' ) }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
