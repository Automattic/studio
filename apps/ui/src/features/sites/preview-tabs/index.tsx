import { __, sprintf } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { showToast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { previewTabsKey, usePreviewTabs, type PreviewTab } from '@/data/preview-tabs';
import { useIsSiteBusy, useStopSite } from '@/data/queries/use-sites';
import { useIsSiteRestarting } from '@/data/site-restarts';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import { useUserWorkspaceLayoutTransition } from '@/data/use-workspace-layout-tracks';
import { getSiteFrontendUrl } from '@/features/sites/get-site-url';
import { getFileManager } from '@/features/sites/open-in-menu/get-file-manager';
import { useOpenInDestinations } from '@/features/sites/open-in-menu/use-open-in-destinations';
import { getFrontendOrigin, getPreviewRealm } from '@/features/sites/site-preview/address-bar';
import { usePreviewOpenTracks } from '@/features/sites/site-preview/use-preview-open-tracks';
import { getSiteTool, SiteToolMenuItems, useSiteToolActions } from '@/features/sites/site-tools';
import { PlusIcon } from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/keyboard';
import { IconButton, Menu, Tabs, TabsList, TabsTrigger, VisuallyHidden } from '@/lib/ui';
import styles from './style.module.css';
import { useTabReorder } from './use-tab-reorder';
import type { SiteDetails } from '@/data/core';

function getTabTitle( tab: PreviewTab, siteName: string, frontendOrigin?: string ) {
	if ( tab.path === null ) return __( 'New tab' );
	const realm = getPreviewRealm( tab.path, frontendOrigin );
	return realm === 'frontend' || realm === 'frontend-app'
		? tab.title || siteName
		: getSiteTool( realm ).label;
}

export function PreviewTabs( {
	site,
	liveUrl,
	path,
}: {
	site: SiteDetails;
	liveUrl?: string;
	path: string;
} ) {
	const connector = useConnector();
	const fileManager = getFileManager();
	const browser = useOpenInDestinations( site ).find( ( entry ) => entry.id === 'browser' )!;
	const { id: siteId, name: siteName } = site;
	// A headless site's frontend app, which its tabs address by absolute URL.
	const frontendOrigin = getFrontendOrigin( liveUrl ? undefined : getSiteFrontendUrl( site ) );
	const restarting = useIsSiteRestarting( siteId );
	const running = !! liveUrl || site.running || restarting;
	const busy = useIsSiteBusy( site );
	const stopSite = useStopSite();
	const preview = useSessionPreviewUI();
	const runLayoutTransition = useUserWorkspaceLayoutTransition( siteId );
	const trackOpen = usePreviewOpenTracks();
	const { workspace, add, patch, select, closeMany, update } = usePreviewTabs(
		previewTabsKey( siteId, liveUrl ),
		path
	);
	const tools = useSiteToolActions( site, {
		liveUrl,
		onNavigate: ( location ) => {
			if ( ! running && workspace.tabs.length === 1 ) {
				patch( workspace.selectedId, { path: location, title: null } );
			} else add( location );
		},
	} );
	const reorder = useTabReorder( {
		ids: workspace.tabs.map( ( tab ) => tab.id ),
		getLabel: ( id ) =>
			getTabTitle( workspace.tabs.find( ( tab ) => tab.id === id )!, siteName, frontendOrigin ),
		onReorder: ( ids ) =>
			update( ( current ) => {
				if (
					ids.length !== current.tabs.length ||
					ids.some( ( id ) => ! current.tabs.some( ( tab ) => tab.id === id ) )
				)
					return current;
				return {
					...current,
					tabs: ids.map( ( id ) => current.tabs.find( ( tab ) => tab.id === id )! ),
				};
			} ),
	} );
	const draggedTab = workspace.tabs.find( ( tab ) => tab.id === reorder.drag?.id );
	const DragIcon = getSiteTool(
		draggedTab?.path ? getPreviewRealm( draggedTab.path, frontendOrigin ) : 'frontend'
	).Icon;
	const list = useRef< HTMLDivElement >( null );
	const newTabButton = useRef< HTMLButtonElement >( null );
	useLayoutEffect( () => {
		const strip = list.current?.closest< HTMLElement >( '[data-slot="tabs"]' );
		if ( ! strip ) return;
		const rtl = getComputedStyle( strip ).direction === 'rtl';
		const updateFades = () => {
			const max = Math.max( 0, strip.scrollWidth - strip.clientWidth );
			const offset = Math.min( max, Math.max( 0, rtl ? -strip.scrollLeft : strip.scrollLeft ) );
			strip.toggleAttribute( 'data-overflow-left', ( rtl ? max - offset : offset ) > 1 );
			strip.toggleAttribute( 'data-overflow-right', ( rtl ? offset : max - offset ) > 1 );
		};
		const revealSelected = () => {
			if ( strip.closest( '[inert]' ) ) return;
			const selected = list.current?.querySelector< HTMLElement >( '[data-active]' );
			const viewport = strip.getBoundingClientRect();
			if ( selected && viewport.width ) {
				const tab = selected.getBoundingClientRect();
				const padding =
					Number.parseFloat( getComputedStyle( strip ).scrollPaddingInlineStart ) || 0;
				const inset = Math.max( 0, Math.min( padding, ( viewport.width - tab.width ) / 2 ) );
				if ( tab.width > viewport.width ) {
					strip.scrollLeft += rtl ? tab.right - viewport.right : tab.left - viewport.left;
				} else if ( tab.left < viewport.left + inset ) {
					strip.scrollLeft += tab.left - viewport.left - inset;
				} else if ( tab.right > viewport.right - inset ) {
					strip.scrollLeft += tab.right - viewport.right + inset;
				}
			}
			updateFades();
		};
		const observer = new ResizeObserver( revealSelected );
		observer.observe( strip );
		strip.addEventListener( 'scroll', updateFades, { passive: true } );
		revealSelected();
		return () => {
			observer.disconnect();
			strip.removeEventListener( 'scroll', updateFades );
		};
	}, [ running, workspace.selectedId, workspace.tabs.length ] );
	const { setOpen } = preview;
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				! isShortcut( event, 't' ) ||
				isDialogOpen() ||
				busy
			)
				return;
			event.preventDefault();
			runLayoutTransition( () => setOpen( true, { siteId } ) );
			requestAnimationFrame( () => {
				if ( newTabButton.current && getComputedStyle( newTabButton.current ).display === 'none' ) {
					add( '/' );
					requestAnimationFrame( () => {
						list.current?.querySelector< HTMLElement >( '[data-active]' )?.focus();
					} );
					return;
				}
				newTabButton.current?.focus();
				if ( newTabButton.current?.getAttribute( 'aria-expanded' ) !== 'true' ) {
					newTabButton.current?.click();
				}
			} );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ add, busy, setOpen, siteId, runLayoutTransition ] );
	const openEmailFolder = () => {
		void connector.openSiteEmailFolder( siteId ).catch( () =>
			showToast( {
				title: __( 'Studio could not open the email folder.' ),
				intent: 'error',
			} )
		);
	};
	const openInBrowser = ( tab: PreviewTab ) => {
		if ( tab.path === null ) return;
		const realm = getPreviewRealm( tab.path, frontendOrigin );
		trackOpen( tab.path, 'external' );
		const opening = liveUrl
			? connector.openExternalUrl( `${ liveUrl.replace( /\/$/, '' ) }${ tab.path }` )
			: connector.openSiteUrl( siteId, tab.path, {
					autoLogin: realm !== 'frontend' && ! tab.path.startsWith( '/studio-auto-login' ),
			  } );
		void opening.catch( ( error ) => {
			console.error( 'Failed to open preview tab in browser:', error );
		} );
	};
	const closeTabs = ( ids: string[] ) => {
		const isLastTab = workspace.tabs.every( ( tab ) => ids.includes( tab.id ) );
		closeMany( ids );
		if ( isLastTab ) {
			runLayoutTransition( () => preview.setOpen( false, { siteId, instant: true } ) );
			if ( ! liveUrl && site.running && ! busy ) stopSite.mutate( siteId );
		}
		requestAnimationFrame( () => {
			if ( isLastTab ) {
				document.querySelector< HTMLElement >( '[data-workspace-layout="chat"]' )?.focus();
			} else {
				list.current?.querySelector< HTMLElement >( '[data-active]' )?.focus();
			}
		} );
	};
	return (
		<div className={ styles.root } data-preview-tabs>
			{ running ? (
				<Tabs
					value={ workspace.selectedId }
					onValueChange={ ( value ) => {
						const id = String( value );
						if ( id === workspace.selectedId ) return;
						const tab = workspace.tabs.find( ( tab ) => tab.id === id );
						if ( tab?.path !== null && tab?.path !== undefined ) trackOpen( tab.path );
						select( id );
					} }
					className={ styles.tabs }
				>
					<TabsList
						ref={ list }
						variant="browser"
						aria-label={ __( 'Preview tabs' ) }
						className={ styles.list }
						data-tab-dragging={ !! reorder.drag || undefined }
						data-tab-drop-committed={ reorder.drag?.committed || undefined }
						onPointerDown={ reorder.onPointerDown }
						onClickCapture={ reorder.onClickCapture }
						onDragStart={ ( event ) => event.preventDefault() }
					>
						{ workspace.tabs.map( ( tab, index ) => {
							const realm =
								tab.path === null ? 'frontend' : getPreviewRealm( tab.path, frontendOrigin );
							const { Icon } = getSiteTool( realm );
							const destination = realm === 'email' ? fileManager : browser;
							return (
								<Menu.ContextMenuRoot key={ tab.id }>
									<Menu.ContextMenuTrigger
										render={
											<div
												className={ styles.tab }
												data-tab-reorder-id={ tab.id }
												data-drag-source={ reorder.drag?.id === tab.id || undefined }
												style={ {
													transform: `translateX(${ reorder.getOffset( tab.id ) }px)`,
												} }
												data-preview-selected={ tab.id === workspace.selectedId || undefined }
											/>
										}
									>
										<TabsTrigger
											value={ tab.id }
											className={ styles.trigger }
											aria-description={ __(
												'Use Alt+Shift+Left or Right Arrow to move this tab.'
											) }
											onKeyDown={ ( event ) => {
												reorder.onKeyDown( event, tab.id );
												if ( event.key === 'Delete' ) {
													event.preventDefault();
													closeTabs( [ tab.id ] );
												}
											} }
										>
											<Icon className={ styles.icon } />
											<span className={ styles.title }>
												{ getTabTitle( tab, siteName, frontendOrigin ) }
											</span>
										</TabsTrigger>
										<IconButton
											variant="muted-ghost"
											size="icon-2xs"
											className={ styles.close }
											data-tab-close
											icon={ <X /> }
											label={ sprintf(
												__( 'Close %s' ),
												getTabTitle( tab, siteName, frontendOrigin )
											) }
											onClick={ () => closeTabs( [ tab.id ] ) }
											tooltipSide="bottom"
										/>
									</Menu.ContextMenuTrigger>
									<Menu.ContextPopup>
										<Menu.Item disabled={ busy } onClick={ () => add( '/' ) }>
											<PlusIcon />
											{ __( 'New tab' ) }
										</Menu.Item>
										<Menu.Item
											disabled={ busy || tab.path === null || realm === 'design' }
											onClick={ realm === 'email' ? openEmailFolder : () => openInBrowser( tab ) }
										>
											{ destination.logo }
											{ /* translators: %s: the browser or system file manager name. */ }
											{ sprintf( __( 'Open in %s' ), destination.label ) }
										</Menu.Item>
										<Menu.Separator />
										<Menu.Item onClick={ () => closeTabs( [ tab.id ] ) }>
											<X />
											{ __( 'Close tab' ) }
										</Menu.Item>
										{ workspace.tabs.length > 1 && (
											<Menu.Item
												onClick={ () =>
													closeTabs(
														workspace.tabs
															.filter( ( other ) => other.id !== tab.id )
															.map( ( other ) => other.id )
													)
												}
											>
												<X />
												{ __( 'Close other tabs' ) }
											</Menu.Item>
										) }
										{ index > 0 && index < workspace.tabs.length - 1 && (
											<Menu.Item
												onClick={ () =>
													closeTabs(
														workspace.tabs.slice( index + 1 ).map( ( other ) => other.id )
													)
												}
											>
												<X />
												{ __( 'Close tabs to the right' ) }
											</Menu.Item>
										) }
										{ workspace.tabs.length > 1 && (
											<Menu.Item
												onClick={ () => closeTabs( workspace.tabs.map( ( other ) => other.id ) ) }
											>
												<X />
												{ __( 'Close all tabs' ) }
											</Menu.Item>
										) }
									</Menu.ContextPopup>
								</Menu.ContextMenuRoot>
							);
						} ) }
					</TabsList>
				</Tabs>
			) : null }
			<Menu.Root>
				<Menu.Trigger
					render={
						<IconButton
							ref={ newTabButton }
							className={ running ? styles.newTab : undefined }
							size="icon-sm"
							variant="muted-ghost"
							icon={ <PlusIcon /> }
							shortcut={ {
								displayShortcut: displayShortcut.primary( 't' ),
								ariaKeyShortcut: ariaKeyShortcut.primary( 't' ),
							} }
							label={ __( 'New tab' ) }
							tooltipSide="bottom"
							disabled={ busy }
						/>
					}
				/>
				<Menu.Popup>
					<SiteToolMenuItems site={ site } actions={ tools } live={ !! liveUrl } />
				</Menu.Popup>
			</Menu.Root>
			<VisuallyHidden role="status">{ reorder.announcement }</VisuallyHidden>
			{ reorder.drag && draggedTab
				? createPortal(
						<div
							className={ styles.dragPreview }
							data-tab-drag-preview
							data-landing={ reorder.drag.landing || undefined }
							aria-hidden="true"
							style={ {
								width: reorder.drag.slots.find( ( slot ) => slot.id === draggedTab.id )!.width,
								height: reorder.drag.slots.find( ( slot ) => slot.id === draggedTab.id )!.height,
								transform: `translate3d(${ reorder.drag.x }px, ${ reorder.drag.y }px, 0)`,
							} }
						>
							<DragIcon className={ styles.icon } />
							<span className={ styles.title }>
								{ getTabTitle( draggedTab, siteName, frontendOrigin ) }
							</span>
						</div>,
						document.body
				  )
				: null }
		</div>
	);
}
