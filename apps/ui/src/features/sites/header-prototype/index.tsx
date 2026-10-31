import { __ } from '@wordpress/i18n';
import { XIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useStopSite,
} from '@/data/queries/use-sites';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { StartSiteIcon, ExpandIcon, CollapseIcon } from '@/lib/icons';
import { Button, IconButton, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test';
const key = 'studio-header-prototype';
const listeners = new Set< () => void >();
let selected = enabled ? localStorage.getItem( key ) ?? 'start-close' : 'current';

export function selectHeaderPrototype( value: 'current' | 'start-close' ) {
	selected = value;
	localStorage.setItem( key, value );
	listeners.forEach( ( listener ) => listener() );
}

export function useHeaderPrototype() {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		() => selected === 'start-close'
	);
}

export function HeaderPrototypePicker() {
	const prototype = useHeaderPrototype();
	if ( ! enabled ) return null;
	return (
		<div className={ styles.picker }>
			<Menu.Root>
				<Menu.Trigger render={ <Button size="sm" variant="outline" /> }>
					{ prototype ? __( 'Header: Start + close' ) : __( 'Header: Current' ) }
				</Menu.Trigger>
				<Menu.Popup side="top" align="start">
					<Menu.RadioGroup
						value={ prototype ? 'start-close' : 'current' }
						onValueChange={ ( value ) =>
							selectHeaderPrototype( value === 'start-close' ? 'start-close' : 'current' )
						}
					>
						<Menu.RadioItem value="current">{ __( 'Current header' ) }</Menu.RadioItem>
						<Menu.RadioItem value="start-close">{ __( 'Start + close' ) }</Menu.RadioItem>
					</Menu.RadioGroup>
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}

export function PrototypeStartButton( { site, live }: { site: SiteDetails; live: boolean } ) {
	const prototype = useHeaderPrototype();
	const start = useStartSiteWithChat();
	const starting = useIsSiteStarting( site.id );
	const stopping = useIsSiteStopping( site.id );
	const stop = useStopSite();
	const busy = useIsSiteBusy( site );
	if ( ! prototype ) return null;
	return (
		<IconButton
			icon={ <StartSiteIcon /> }
			label={ site.running && ! stopping ? __( 'Stop site' ) : __( 'Start site' ) }
			variant="ghost"
			aria-pressed={ !! site.running && ! stopping }
			disabled={ busy || live }
			loading={ starting && ! stopping }
			loadingMode="replace"
			onClick={ () => ( site.running ? stop.mutate( site.id ) : start.mutate( site.id ) ) }
			tooltipSide="bottom"
		/>
	);
}

export function PrototypePreviewControls( {
	site,
	live,
	fullscreen,
}: {
	site: SiteDetails;
	live: boolean;
	fullscreen: { active: boolean; onChange: ( active: boolean ) => void };
} ) {
	const prototype = useHeaderPrototype();
	const stop = useStopSite();
	const busy = useIsSiteBusy( site );
	const starting = useIsSiteStarting( site.id );
	const stopping = useIsSiteStopping( site.id );
	if ( ! prototype ) return null;
	const open = ! stopping && ( !! site.running || live || starting );
	return (
		<span
			className={ styles.previewControls }
			data-open={ open }
			aria-hidden={ ! open }
			inert={ ! open }
		>
			<span className={ styles.previewControlsContent }>
				<IconButton
					icon={ fullscreen.active ? <CollapseIcon /> : <ExpandIcon /> }
					label={ fullscreen.active ? __( 'Exit fullscreen' ) : __( 'Enter fullscreen' ) }
					onClick={ () => fullscreen.onChange( ! fullscreen.active ) }
					tooltipSide="bottom"
				/>
				<IconButton
					icon={ <XIcon /> }
					label={ __( 'Stop site and close preview' ) }
					disabled={ busy || live || ! site.running }
					onClick={ () => stop.mutate( site.id ) }
					tooltipSide="bottom"
				/>
			</span>
		</span>
	);
}
