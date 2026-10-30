import { isRTL, __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useIsSiteBusy, useStartSite } from '@/data/queries/use-sites';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import {
	hasAnnotationContent,
	isAnnotationsBusy,
	setAnnotating,
	useSiteAnnotations,
} from '@/features/annotations';
import { ShareButton, PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { AnnotateButton } from '@/features/sites/site-preview/preview-header/annotate-button';
import { useMediaQuery, useWindowControlsOverlay } from '@/lib/hooks';
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, RotateCwIcon } from '@/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger, Menu, Button } from '@/lib/ui';
import styles from './style.module.css';
import { useSiteHeaderLayout, type SiteHeaderLayout } from './use-site-header-layout';
import type { SiteDetails } from '@/data/core';

/** The preview's browser controls, for the More menu once they no longer fit. */
interface SiteHeaderNavigation {
	canGoBack: boolean;
	canGoForward: boolean;
	disabled: boolean;
	back: () => void;
	forward: () => void;
	reload: () => void;
	openExternal?: () => void;
	annotate?: { active: boolean; disabled: boolean; disabledReason?: string; onClick: () => void };
	backShortcut: string;
	forwardShortcut: string;
}

interface SiteHeaderContextValue {
	// The header the actions sit over: the preview's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'preview' | null;
	layout: SiteHeaderLayout;
	actionsWidth: number;
	browserSpace: HTMLElement | null;
	attachBrowserSpace: ( node: HTMLElement | null ) => void;
	navigation: SiteHeaderNavigation | null;
	attachActions: ( node: HTMLElement | null ) => void;
	setNavigation: ( navigation: SiteHeaderNavigation | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	layout: 'inline',
	actionsWidth: 0,
	browserSpace: null,
	attachBrowserSpace: () => undefined,
	navigation: null,
	attachActions: () => undefined,
	setNavigation: () => undefined,
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
	const [ navigation, setNavigation ] = useState< SiteHeaderNavigation | null >( null );
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
				navigation: host === 'preview' ? navigation : null,
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
	const { actionsWidth } = useSiteHeader();
	return <div className={ styles.space } style={ { width: actionsWidth } } />;
}

/** The preview row hosts its overflow controls independently of the main header. */
export function SiteHeaderBrowserSpace() {
	const { attachBrowserSpace } = useSiteHeader();
	return <div ref={ attachBrowserSpace } className={ styles.browserSpace } />;
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
	const annotateActive = navigation?.annotate?.active;
	const annotateDisabled = navigation?.annotate?.disabled;
	const annotateDisabledReason = navigation?.annotate?.disabledReason;
	const hasAnnotate = Boolean( navigation?.annotate );
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
			openExternal: canOpenExternal ? () => latest.current?.openExternal?.() : undefined,
			annotate: hasAnnotate
				? {
						active: annotateActive ?? false,
						disabled: annotateDisabled ?? false,
						disabledReason: annotateDisabledReason,
						onClick: () => latest.current?.annotate?.onClick(),
				  }
				: undefined,
			backShortcut,
			forwardShortcut,
		} );
		return () => setNavigation( null );
	}, [
		annotateActive,
		annotateDisabled,
		annotateDisabledReason,
		hasAnnotate,
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

/** Site actions stay in one place as the preview opens and closes. */
export function SiteHeaderActions( {
	site,
	live = false,
	onStartAnnotating,
	onSendAnnotations,
	end,
}: {
	site: SiteDetails;
	live?: boolean;
	onStartAnnotating?: () => boolean;
	onSendAnnotations?: ( siteId: string ) => void;
	end?: ReactNode;
} ) {
	const { host, layout, navigation, attachActions, browserSpace } = useSiteHeader();
	const connector = useConnector();
	const startSite = useStartSite();
	const busy = useIsSiteBusy( site );
	const preview = useSessionPreviewUI();
	const annotations = useSiteAnnotations( site.id );
	const narrow = useMediaQuery( '(max-width: 540px)' );
	const annotation = navigation?.annotate ?? {
		active: annotations.active,
		disabled: live || busy || ! connector.capabilities.annotatePreview,
		disabledReason: ! connector.capabilities.annotatePreview
			? __( 'Site annotation is not available in the browser yet' )
			: undefined,
		onClick: () => {
			if ( annotations.active ) {
				setAnnotating( site.id, false );
				return;
			}
			if ( onStartAnnotating?.() === false ) return;
			preview.setOpen( true );
			preview.setChatHidden( narrow, site.id );
			setAnnotating( site.id, true );
			if ( ! site.running ) {
				startSite.mutate( site.id, { onError: () => setAnnotating( site.id, false ) } );
			}
		},
	};
	const root = useRef< HTMLDivElement >( null );
	const windowControls = useWindowControlsOverlay();
	const trafficLightSpace = useTrafficLightSpace();
	const overflow = host === 'preview' && layout !== 'inline' && layout !== 'mobile-overflow';
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
			data-site-header-actions={ layout }
		>
			<SiteDeliveryDialog key={ site.id } site={ site } anchor={ root } />
			<div ref={ attachActions } className={ styles.actions }>
				{ overflow && browserSpace
					? createPortal(
							<span data-site-header-trailing className={ styles.item }>
								<Menu.Root modal={ false }>
									<Tooltip>
										<Menu.Trigger
											render={
												<TooltipTrigger
													render={
														<Button
															variant="ghost"
															size="icon-sm"
															data-share-overflow-trigger
															aria-label={ __( 'More preview actions' ) }
														/>
													}
												/>
											}
										>
											<EllipsisIcon />
										</Menu.Trigger>
										<TooltipContent side="bottom">{ __( 'More preview actions' ) }</TooltipContent>
									</Tooltip>
									<Menu.Popup side="bottom" align="end">
										{ navigation?.openExternal ? (
											<Menu.Item
												disabled={ navigation.disabled }
												onClick={ navigation.openExternal }
											>
												<ExternalLinkIcon />
												{ __( 'Open in browser' ) }
											</Menu.Item>
										) : null }
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
											</>
										) : null }
									</Menu.Popup>
								</Menu.Root>
							</span>,
							browserSpace
					  )
					: null }
				<div data-site-header-delivery className={ styles.delivery }>
					<span data-site-header-annotate className={ styles.item }>
						<AnnotateButton
							{ ...annotation }
							iconOnly
							send={ {
								count: annotations.notes.filter( hasAnnotationContent ).length,
								disabled: isAnnotationsBusy( annotations ) || ! onSendAnnotations,
								loading: Boolean( annotations.sending ),
								onClick: () => {
									onSendAnnotations?.( site.id );
									setAnnotating( site.id, false );
								},
							} }
						/>
					</span>
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
