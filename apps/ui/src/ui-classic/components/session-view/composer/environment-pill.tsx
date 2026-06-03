import { __, sprintf } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Icon, Tooltip } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useSetSessionEnvironment } from '@/data/queries/use-sessions';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';
import type { ReactElement } from 'react';

interface EnvironmentPillProps {
	sessionId: string;
	effectiveEnvironment: 'local' | 'live';
	liveSite: SyncSite | undefined;
	disabled?: boolean;
}

function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

function EnvironmentTooltip( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger render={ children } />
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

function EnvironmentMenuTrigger( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Menu.Trigger render={ <Tooltip.Trigger render={ children } /> } />
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

/**
 * Toggle the active environment for the current session between local and the
 * linked WordPress.com live site. The owner site itself never changes — this
 * appends a fresh `site.selected` event naming the side to use next.
 *
 * `effectiveEnvironment` is derived upstream from the session's stored
 * `activeEnvironment` joined with the current connected-sites snapshot — a
 * session whose live was disconnected reads as 'local' until the user
 * reconnects and explicitly flips back. The "Live" option is disabled when no
 * live site is currently linked.
 */
export function EnvironmentPill( {
	sessionId,
	effectiveEnvironment,
	liveSite,
	disabled = false,
}: EnvironmentPillProps ) {
	const setEnvironment = useSetSessionEnvironment( sessionId, liveSite?.id );
	const isLive = effectiveEnvironment === 'live';
	const label = isLive ? __( 'Live' ) : __( 'Local' );
	const tooltipLabel = sprintf( __( 'Environment: %s' ), label );
	const canGoLive = !! liveSite;

	const onValueChange = ( value: string ) => {
		if ( value !== 'local' && value !== 'live' ) {
			return;
		}
		if ( value === effectiveEnvironment ) {
			return;
		}
		if ( value === 'live' && ! canGoLive ) {
			return;
		}
		setEnvironment.mutate( value );
	};

	if ( disabled ) {
		return (
			<EnvironmentTooltip label={ tooltipLabel }>
				<button type="button" className={ styles.pill } aria-label={ tooltipLabel } disabled>
					<span
						className={ `${ styles.pillDot } ${ isLive ? styles.pillDotLive : '' }` }
						aria-hidden="true"
					/>
					<span>{ label }</span>
					<Icon icon={ chevronDownSmall } size={ 16 } />
				</button>
			</EnvironmentTooltip>
		);
	}

	return (
		<Menu.Root modal={ false }>
			<EnvironmentMenuTrigger label={ tooltipLabel }>
				<button type="button" className={ styles.pill } aria-label={ tooltipLabel }>
					<span
						className={ `${ styles.pillDot } ${ isLive ? styles.pillDotLive : '' }` }
						aria-hidden="true"
					/>
					<span>{ label }</span>
					<Icon icon={ chevronDownSmall } size={ 16 } />
				</button>
			</EnvironmentMenuTrigger>
			<Menu.Popup side="top" align="end" className={ styles.envMenuPopup }>
				<Menu.RadioGroup value={ effectiveEnvironment } onValueChange={ onValueChange }>
					<Menu.RadioItem value="local">{ __( 'Local' ) }</Menu.RadioItem>
					<Menu.RadioItem value="live" disabled={ ! canGoLive }>
						{ __( 'Live' ) }
					</Menu.RadioItem>
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}

export { pickLiveSite };
