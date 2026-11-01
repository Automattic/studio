import { isRTL } from '@wordpress/i18n';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { ShareButton, PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { useWindowControlsOverlay } from '@/lib/hooks';
import styles from './style.module.css';
import { useSiteHeaderLayout, type SiteHeaderLayout } from './use-site-header-layout';
import type { SiteDetails } from '@/data/core';

interface SiteHeaderContextValue {
	// The header the actions sit over: the preview's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'preview' | null;
	layout: SiteHeaderLayout;
	actionsWidth: number;
	browserSpace: HTMLElement | null;
	attachBrowserSpace: ( node: HTMLElement | null ) => void;
	attachActions: ( node: HTMLElement | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	layout: 'inline',
	actionsWidth: 0,
	browserSpace: null,
	attachBrowserSpace: () => undefined,
	attachActions: () => undefined,
} );

export const useSiteHeader = () => useContext( SiteHeaderContext );

/** Keeps delivery actions and their dialogs mounted while the preview layout changes. */
export function SiteHeaderActionsProvider( {
	host,
	children,
}: {
	host: 'chat' | 'preview';
	children: ReactNode;
} ) {
	const [ actions, attachActions ] = useState< HTMLElement | null >( null );
	const [ browserSpace, attachBrowserSpace ] = useState< HTMLElement | null >( null );
	const { layout, actionsWidth } = useSiteHeaderLayout( actions, browserSpace );

	return (
		<SiteHeaderContext.Provider
			value={ {
				host,
				layout,
				actionsWidth,
				browserSpace,
				attachBrowserSpace,
				attachActions,
			} }
		>
			{ children }
		</SiteHeaderContext.Provider>
	);
}

/** The room a header leaves for the site actions drawn over it. */
export function SiteHeaderSpace() {
	const { actionsWidth } = useSiteHeader();
	return <div className={ styles.space } style={ { width: actionsWidth } } />;
}

/** Registers the preview row for its narrow-window layout. */
export function SiteHeaderBrowserSpace() {
	const { attachBrowserSpace } = useSiteHeader();
	return <div ref={ attachBrowserSpace } className={ styles.browserSpace } />;
}

/** Site actions stay in one place as the preview opens and closes. */
export function SiteHeaderActions( { site, end }: { site: SiteDetails; end?: ReactNode } ) {
	const { attachActions } = useSiteHeader();
	const root = useRef< HTMLDivElement >( null );
	const windowControls = useWindowControlsOverlay();
	const trafficLightSpace = useTrafficLightSpace();
	// The Windows/Linux window controls sit at the physical right, the macOS
	// traffic lights at the physical left: whichever the inline end reaches.
	let inset = 0;
	if ( isRTL() ) {
		inset += trafficLightSpace.end ? 88 : 0;
	} else {
		inset += windowControls?.controlsWidth ?? 0;
	}
	const publishButton = (
		<span data-site-header-publish className={ styles.publish }>
			<PublishButton site={ site } />
		</span>
	);
	return (
		<div
			ref={ root }
			className={ styles.root }
			style={ { paddingInlineEnd: `calc( var( --band-inset ) + ${ inset }px )` } }
			data-site-header-actions
		>
			<SiteDeliveryDialog key={ site.id } site={ site } anchor={ root } />
			<div ref={ attachActions } className={ styles.actions }>
				<div data-site-header-delivery className={ styles.delivery }>
					<span data-site-header-share className={ styles.item }>
						<ShareButton site={ site } />
					</span>
					{ publishButton }
				</div>
				{ end ? (
					<span data-site-header-end className={ styles.item }>
						{ end }
					</span>
				) : null }
			</div>
		</div>
	);
}
