import { IconButton } from '@studio/ds';
import { PlayIcon, SquareIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useInlineEndControlsInset } from '@/data/host/use-window-controls-inset';
import { useIsSiteBusy, useIsSiteStarting, useStopSite } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { PublishButton } from '@/features/site-delivery';
import styles from './style.module.css';
import { useSiteHeaderLayout, type SiteHeaderLayout } from './use-site-header-layout';
import type { SiteDetails } from '@/data/core';

interface SiteHeaderContextValue {
	// The header the actions sit over: the panel's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'panel' | null;
	layout: SiteHeaderLayout;
	actionsWidth: number;
	annotationSpace: HTMLElement | null;
	attachAnnotationSpace: ( node: HTMLElement | null ) => void;
	attachBrowserHeader: ( node: HTMLElement | null ) => void;
	attachActions: ( node: HTMLElement | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	layout: 'inline',
	actionsWidth: 0,
	annotationSpace: null,
	attachAnnotationSpace: () => undefined,
	attachBrowserHeader: () => undefined,
	attachActions: () => undefined,
} );

export const useSiteHeader = () => useContext( SiteHeaderContext );

/** Keeps delivery actions and their dialogs mounted while the panel layout changes. */
export function SiteHeaderActionsProvider( {
	host,
	children,
}: {
	host: 'chat' | 'panel';
	children: ReactNode;
} ) {
	const [ annotationSpace, attachAnnotationSpace ] = useState< HTMLElement | null >( null );
	const [ actions, attachActions ] = useState< HTMLElement | null >( null );
	const [ browserHeader, attachBrowserHeader ] = useState< HTMLElement | null >( null );
	const { layout, actionsWidth } = useSiteHeaderLayout( actions, browserHeader );

	return (
		<SiteHeaderContext.Provider
			value={ {
				host,
				layout,
				actionsWidth,
				annotationSpace,
				attachAnnotationSpace,
				attachBrowserHeader,
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

/** Site actions stay in one place as the panel opens and closes. */
export function SiteHeaderActions( { site }: { site: SiteDetails } ) {
	const { attachActions } = useSiteHeader();
	const root = useRef< HTMLDivElement >( null );
	const inset = useInlineEndControlsInset();
	const start = useStartSiteWithChat();
	const stop = useStopSite();
	const siteBusy = useIsSiteBusy( site );
	const isStarting = useIsSiteStarting( site.id ) || site.operation?.kind === 'start';
	const sync = useSiteSyncActivity( site.id );
	const busy = siteBusy || ( sync?.kind === 'pending' && sync.direction !== 'preview' );
	const publishButton = (
		<span data-site-header-publish className={ styles.publish }>
			<PublishButton key={ site.id } site={ site } />
		</span>
	);
	return (
		<div
			ref={ root }
			className={ styles.root }
			style={ { paddingInlineEnd: `calc( var( --band-inset ) + ${ inset }px )` } }
			data-site-header-actions
		>
			<div ref={ attachActions } className={ styles.actions }>
				<div data-site-header-delivery className={ styles.delivery }>
					{ publishButton }
					<IconButton
						variant="ghost"
						size="icon-sm"
						icon={ site.running ? <SquareIcon /> : <PlayIcon /> }
						label={
							isStarting
								? __( 'Starting site' )
								: site.running
								? __( 'Stop site' )
								: __( 'Start site' )
						}
						loading={ isStarting }
						loadingMode="replace"
						tooltipSide="bottom"
						disabled={ busy }
						onClick={ () => ( site.running ? stop : start ).mutate( site.id ) }
					/>
				</div>
			</div>
		</div>
	);
}
