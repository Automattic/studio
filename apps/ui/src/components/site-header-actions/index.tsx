import { isRTL, __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { PublishButton } from '@/components/publish-panel';
import { ShareButton, ShareStatusIcon, useShareStatus } from '@/components/share-dialog';
import { SiteLifecycleButton } from '@/components/site-lifecycle-button';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsSiteStarting, useIsSiteStopping, useSiteOperation } from '@/data/queries/use-sites';
import { requestHeaderPanel } from '@/hooks/use-open-header-panel';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { ArrowLeftIcon } from '@/lib/icons/arrow-left-icon';
import { ArrowRightIcon } from '@/lib/icons/arrow-right-icon';
import { ExternalLinkIcon } from '@/lib/icons/external-link-icon';
import { RotateCwIcon } from '@/lib/icons/rotate-cw-icon';
import { ShareIcon } from '@/lib/icons/share-icon';
import { SiteSettingsIcon } from '@/lib/icons/site-settings-icon';
import styles from './style.module.css';
import { useSiteHeaderLayout, type SiteHeaderLayout } from './use-site-header-layout';
import type { SiteDetails } from '@/data/core';

export type { SiteHeaderLayout } from './use-site-header-layout';

/** The preview's browser controls, for the More menu once they no longer fit. */
export interface SiteHeaderNavigation {
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
	back: () => void;
	forward: () => void;
	reload: () => void;
	settings: () => void;
	openExternal?: () => void;
	backShortcut: string;
	forwardShortcut: string;
}

interface SiteHeaderContextValue {
	// The header the actions sit over: the preview's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'preview' | null;
	layout: SiteHeaderLayout;
	actionsWidth: number;
	navigation: SiteHeaderNavigation | null;
	attachSpace: ( node: HTMLElement | null ) => void;
	attachActions: ( node: HTMLElement | null ) => void;
	setNavigation: ( navigation: SiteHeaderNavigation | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	layout: 'inline',
	actionsWidth: 0,
	navigation: null,
	attachSpace: () => undefined,
	attachActions: () => undefined,
	setNavigation: () => undefined,
} );

export const useSiteHeader = () => useContext( SiteHeaderContext );

/**
 * Holds the state of a site's header actions — Publish, Start or Stop, and
 * Share — which `SiteHeaderActions` draws once over the workspace's top
 * inline-end corner, whichever header lies under it, so they keep their state
 * and focus as the chat and preview come and go. The header there holds a
 * `SiteHeaderSpace` the actions fit into.
 */
export function SiteHeaderActionsProvider( {
	host,
	children,
}: {
	host: 'chat' | 'preview';
	children: ReactNode;
} ) {
	const [ space, attachSpace ] = useState< HTMLElement | null >( null );
	const [ actions, attachActions ] = useState< HTMLElement | null >( null );
	const [ navigation, setNavigation ] = useState< SiteHeaderNavigation | null >( null );
	const { layout, actionsWidth } = useSiteHeaderLayout( space, actions );
	return (
		<SiteHeaderContext.Provider
			value={ {
				host,
				layout,
				actionsWidth,
				navigation: host === 'preview' ? navigation : null,
				attachSpace,
				attachActions,
				setNavigation,
			} }
		>
			{ children }
		</SiteHeaderContext.Provider>
	);
}

/** The room a header leaves for the site actions drawn over it. */
export function SiteHeaderSpace() {
	const { attachSpace, actionsWidth } = useSiteHeader();
	return <div ref={ attachSpace } className={ styles.space } style={ { width: actionsWidth } } />;
}

/** Hands the preview's browser controls to the More menu while it's on screen. */
export function useSiteHeaderNavigation( navigation: SiteHeaderNavigation | null ) {
	const { setNavigation } = useSiteHeader();
	const latest = useRef( navigation );
	useEffect( () => {
		latest.current = navigation;
	} );
	const available = navigation !== null;
	const {
		canGoBack = false,
		canGoForward = false,
		disabled = false,
		backShortcut = '',
		forwardShortcut = '',
	} = navigation ?? {};
	const canOpenExternal = Boolean( navigation?.openExternal );
	useEffect( () => {
		if ( ! available ) {
			return;
		}
		setNavigation( {
			canGoBack,
			canGoForward,
			disabled,
			back: () => latest.current?.back(),
			forward: () => latest.current?.forward(),
			reload: () => latest.current?.reload(),
			settings: () => latest.current?.settings(),
			openExternal: canOpenExternal ? () => latest.current?.openExternal?.() : undefined,
			backShortcut,
			forwardShortcut,
		} );
		return () => setNavigation( null );
	}, [
		available,
		backShortcut,
		canGoBack,
		canGoForward,
		canOpenExternal,
		disabled,
		forwardShortcut,
		setNavigation,
	] );
}

export function SiteHeaderActions( { site }: { site: SiteDetails } ) {
	const { host, layout, navigation, attachActions } = useSiteHeader();
	const root = useRef< HTMLDivElement >( null );
	const shareStatus = useShareStatus( site.id );
	const operation = useSiteOperation( site );
	const starting = useIsSiteStarting( site.id ) || operation === 'start';
	const stopping = useIsSiteStopping( site.id ) || operation === 'stop';
	const windowControls = useWindowControlsOverlay();
	const trafficLightSpace = useTrafficLightSpace();
	const overflow = layout !== 'inline';
	// The Windows/Linux window controls sit at the physical right, the macOS
	// traffic lights at the physical left: whichever the inline end reaches.
	let inset = 8;
	if ( isRTL() ) {
		inset += trafficLightSpace.end ? 88 : 0;
	} else {
		inset += windowControls?.controlsWidth ?? 0;
	}
	return (
		<div
			ref={ root }
			className={ styles.root }
			style={ { paddingInlineEnd: inset } }
			data-site-header-actions={ layout }
		>
			<div ref={ attachActions } className={ styles.actions }>
				{ /* Out of sight while the chat fills the workspace, yet still there
					for the site menu to open. */ }
				<span
					data-site-header-publish
					hidden={ host !== 'preview' || ! site.running || starting || stopping }
					className={ styles.publish }
				>
					<PublishButton site={ site } anchor={ root } />
				</span>
				<span data-site-header-lifecycle className={ styles.item }>
					<SiteLifecycleButton site={ site } compact={ overflow } />
				</span>
				<span data-site-header-trailing className={ styles.item }>
					<span hidden={ overflow }>
						<ShareButton site={ site } />
					</span>
					{ overflow ? (
						<Menu.Root modal={ false }>
							<Tooltip>
								<Menu.Trigger
									render={
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon"
													aria-label={ __( 'More preview actions' ) }
													aria-description={ shareStatus.label }
												/>
											}
										/>
									}
								>
									<ShareStatusIcon icon={ <EllipsisIcon /> } status={ shareStatus } />
								</Menu.Trigger>
								<TooltipContent side="bottom">{ __( 'More preview actions' ) }</TooltipContent>
							</Tooltip>
							<Menu.Popup side="bottom" align="end">
								<Menu.Item
									aria-description={ shareStatus.label }
									onClick={ () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) }
								>
									<ShareStatusIcon icon={ <ShareIcon /> } status={ shareStatus } />
									{ __( 'Share' ) }
								</Menu.Item>
								{ layout === 'navigation-overflow' && navigation ? (
									<>
										<Menu.Separator />
										<Menu.Item
											disabled={ navigation.disabled || ! navigation.canGoBack }
											onClick={ navigation.back }
										>
											<ArrowLeftIcon />
											{ __( 'Back' ) }
											<Menu.Shortcut>{ navigation.backShortcut }</Menu.Shortcut>
										</Menu.Item>
										<Menu.Item
											disabled={ navigation.disabled || ! navigation.canGoForward }
											onClick={ navigation.forward }
										>
											<ArrowRightIcon />
											{ __( 'Forward' ) }
											<Menu.Shortcut>{ navigation.forwardShortcut }</Menu.Shortcut>
										</Menu.Item>
										<Menu.Item disabled={ navigation.disabled } onClick={ navigation.reload }>
											<RotateCwIcon />
											{ __( 'Reload preview' ) }
										</Menu.Item>
										<Menu.Item disabled={ navigation.disabled } onClick={ navigation.settings }>
											<SiteSettingsIcon />
											{ __( 'Site settings' ) }
										</Menu.Item>
										{ navigation.openExternal ? (
											<Menu.Item
												disabled={ navigation.disabled }
												onClick={ navigation.openExternal }
											>
												<ExternalLinkIcon />
												{ __( 'Open in browser' ) }
											</Menu.Item>
										) : null }
									</>
								) : null }
							</Menu.Popup>
						</Menu.Root>
					) : null }
				</span>
			</div>
		</div>
	);
}
