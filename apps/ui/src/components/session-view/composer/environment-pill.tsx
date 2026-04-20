import { __ } from '@wordpress/i18n';
import { chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useSetSessionEnvironment } from '@/data/queries/use-sessions';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';

interface EnvironmentPillProps {
	sessionId: string;
	activeEnvironment: 'local' | 'live';
	liveSite: SyncSite;
	disabled?: boolean;
}

function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

/**
 * Toggle the active environment for the current session between local and the
 * linked WordPress.com live site. The owner site itself never changes — this
 * only swaps which tool set the next agent turn will use.
 *
 * The caller is expected to omit this pill entirely when no live site is
 * linked; when a run is in flight it stays rendered but non-interactive so the
 * user can still see the current env at a glance.
 */
export function EnvironmentPill( {
	sessionId,
	activeEnvironment,
	disabled = false,
}: EnvironmentPillProps ) {
	const setEnvironment = useSetSessionEnvironment( sessionId );
	const isLive = activeEnvironment === 'live';
	const label = isLive ? __( 'Live' ) : __( 'Local' );

	const onValueChange = ( value: string ) => {
		if ( value !== 'local' && value !== 'live' ) {
			return;
		}
		if ( value === activeEnvironment ) {
			return;
		}
		setEnvironment.mutate( value );
	};

	if ( disabled ) {
		return (
			<button type="button" className={ styles.pill } disabled>
				<span
					className={ `${ styles.pillDot } ${ isLive ? styles.pillDotLive : '' }` }
					aria-hidden="true"
				/>
				<span>{ label }</span>
				<Icon icon={ chevronDownSmall } size={ 16 } />
			</button>
		);
	}

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<button type="button" className={ styles.pill }>
						<span
							className={ `${ styles.pillDot } ${ isLive ? styles.pillDotLive : '' }` }
							aria-hidden="true"
						/>
						<span>{ label }</span>
						<Icon icon={ chevronDownSmall } size={ 16 } />
					</button>
				}
			/>
			<Menu.Popup side="top" align="end" className={ styles.envMenuPopup }>
				<Menu.RadioGroup value={ activeEnvironment } onValueChange={ onValueChange }>
					<Menu.RadioItem value="local">{ __( 'Local' ) }</Menu.RadioItem>
					<Menu.RadioItem value="live">{ __( 'Live' ) }</Menu.RadioItem>
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}

export { pickLiveSite };
