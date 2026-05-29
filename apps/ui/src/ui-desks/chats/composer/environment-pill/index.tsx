import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useSetSessionEnvironment } from '@/data/queries/use-sessions';
import { Button, Menu } from '@/ui-desks/components';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';

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

export function EnvironmentPill( {
	sessionId,
	effectiveEnvironment,
	liveSite,
	disabled = false,
}: EnvironmentPillProps ) {
	const setEnvironment = useSetSessionEnvironment( sessionId, liveSite?.id );
	const isLive = effectiveEnvironment === 'live';
	const label = isLive ? __( 'Live' ) : __( 'Local' );
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
			<Button
				label={ __( 'Select environment' ) }
				tooltipLabel={ false }
				variant="quiet"
				size="small"
				disabled
			>
				<span
					className={ `${ styles.environmentDot } ${ isLive ? styles.environmentDotLive : '' }` }
					aria-hidden="true"
				/>
				<span>{ label }</span>
				<Icon icon={ chevronDownSmall } size={ 14 } />
			</Button>
		);
	}

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<Button
						label={ __( 'Select environment' ) }
						tooltipLabel={ false }
						variant="quiet"
						size="small"
					>
						<span
							className={ `${ styles.environmentDot } ${
								isLive ? styles.environmentDotLive : ''
							}` }
							aria-hidden="true"
						/>
						<span>{ label }</span>
						<Icon icon={ chevronDownSmall } size={ 14 } />
					</Button>
				}
			/>
			<Menu.Popup side="top" align="start" width="content" className={ styles.environmentMenu }>
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
