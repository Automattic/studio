import * as Sentry from '@sentry/electron/renderer';
import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { XDebugIcon } from 'src/components/icons/xdebug-icon';
import { Tooltip } from 'src/components/tooltip';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { syncOperationsSelectors } from 'src/stores/sync';

interface SiteMenuProps {
	className?: string;
}

function ButtonToRun( site: SiteDetails ) {
	const { running, id, name, enableXdebug } = site;
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const siteStartedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site started.' ),
		name
	);
	const siteStoppedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site stopped.' ),
		name
	);

	useEffect( () => {
		speak( running ? siteStartedMessage : siteStoppedMessage );
	}, [ running, siteStartedMessage, siteStoppedMessage ] );

	const classCircle = `rounded-full`;
	const triangle = (
		<svg
			aria-hidden="true"
			width="8"
			height="10"
			viewBox="0 0 8 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="rtl:scale-x-[-1]"
		>
			<path
				d="M0.25 0.854923C0.25 0.663717 0.455914 0.543288 0.622565 0.63703L7.17821 4.32458C7.33948 4.41529 7.34975 4.64367 7.19728 4.74849L0.641632 9.2555C0.475757 9.36953 0.25 9.25078 0.25 9.04949V0.854923Z"
				fill="#1ED15A"
				stroke="#00BA37"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const rectangle = (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M0.25 2C0.25 1.0335 1.0335 0.25 2 0.25H8C8.9665 0.25 9.75 1.0335 9.75 2V8C9.75 8.9665 8.9665 9.75 8 9.75H2C1.0335 9.75 0.25 8.9665 0.25 8V2Z"
				fill="#FF8085"
				stroke="#F86368"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const tooltipText = loadingServer[ id ]
		? __( 'Starting' )
		: running
		? __( 'Stop site' )
		: __( 'Start site' );

	return (
		<Tooltip text={ tooltipText }>
			<button
				type="button"
				aria-disabled={ loadingServer[ id ] }
				onClick={ () => {
					if ( loadingServer[ id ] ) {
						return;
					}
					return running ? stopServer( id ) : startServer( site );
				} }
				className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				aria-label={ sprintf( running ? __( 'stop %s site' ) : __( 'start %s site' ), name ) }
			>
				{ /* Circle or Xdebug icon */ }
				{ enableXdebug ? (
					<div
						className={ cx(
							'transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0',
							'row-start-1 col-start-1 place-self-center',
							loadingServer[ id ] && 'animate-pulse duration-100'
						) }
					>
						<XDebugIcon greyed={ ! running && ! loadingServer[ id ] } />
					</div>
				) : (
					<div
						className={ cx(
							'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
							'row-start-1 col-start-1 place-self-center',
							classCircle,
							loadingServer[ id ] &&
								'animate-pulse border-a8c-green-20/50 bg-a8c-green-20/50 duration-100',
							running && 'border-a8c-green-20 bg-a8c-green-20 duration-100',
							! running && ! loadingServer[ id ] && 'border-chrome-border bg-chrome-surface'
						) }
					>
						&nbsp;
					</div>
				) }
				{ /* Shapes on hover */ }
				{ ! loadingServer[ id ] && (
					<div
						className={ cx(
							'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
							'row-start-1 col-start-1 place-self-center'
						) }
					>
						{ running ? rectangle : triangle }
					</div>
				) }
			</button>
		</Tooltip>
	);
}
function SiteItem( {
	site,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	isDragging,
	offset,
}: {
	site: SiteDetails;
	onDragStart: ( e: React.DragEvent ) => void;
	onDragOver: ( e: React.DragEvent ) => void;
	onDrop: ( e: React.DragEvent ) => void;
	onDragEnd: () => void;
	isDragging: boolean;
	offset: number;
} ) {
	const { sites, selectedSite, setSelectedSiteId, loadingServer, isSiteDeleting } =
		useSiteDetails();
	const isSelected = site === selectedSite;
	const { isSiteImporting, isSiteExporting } = useImportExport();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const isImporting = isSiteImporting( site.id );
	const isExporting = isSiteExporting( site.id );
	const isPulling = useRootSelector( syncOperationsSelectors.selectIsSiteIdPulling( site.id ) );
	const isPushing = useRootSelector( syncOperationsSelectors.selectIsSiteIdPushing( site.id ) );
	const isSyncing = isPulling || isPushing;
	const isDeleting = isSiteDeleting( site.id );
	const showSpinner =
		site.isAddingSite || isImporting || isPulling || isPushing || isExporting || isDeleting;

	let tooltipText: string;
	if ( site.isAddingSite ) {
		tooltipText = __( 'Adding' );
	} else if ( isImporting ) {
		tooltipText = __( 'Importing' );
	} else if ( isSyncing ) {
		tooltipText = __( 'Syncing' );
	} else {
		tooltipText = __( 'Loading' );
	}

	const handleContextMenu = ( e: React.MouseEvent ) => {
		e.preventDefault();
		const ipcApi = getIpcApi();
		const isLoading = loadingServer[ site.id ] || false;
		const isAddingSite = site.isAddingSite || false;
		const isAnySiteAdding = sites.some( ( s ) => s.isAddingSite );
		const finderLabel = isWindows() ? __( 'File Explorer' ) : __( 'Finder' );
		const editorLabel =
			editor && supportedEditorConfig[ editor ] ? supportedEditorConfig[ editor ].label : null;
		const terminalLabel = getTerminalName( terminal );

		ipcApi.showSiteContextMenu( {
			siteId: site.id,
			isRunning: site.running,
			isLoading,
			isAddingSite,
			isAnySiteAdding,
			isSyncing,
			finderLabel,
			editorLabel,
			terminalLabel,
		} );
	};

	return (
		<li
			className={ cx(
				'flex flex-row hover:bg-chrome-surface-hover rounded items-center transition-transform duration-200 ease-in-out',
				isSelected && 'bg-chrome-surface hover:bg-chrome-surface',
				isDragging && 'opacity-30'
			) }
			style={ offset ? { transform: `translateY(${ offset }px)` } : undefined }
			onContextMenu={ handleContextMenu }
			draggable
			onDragStart={ onDragStart }
			onDragOver={ onDragOver }
			onDrop={ onDrop }
			onDragEnd={ onDragEnd }
		>
			<button
				type="button"
				className={ cx(
					'p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
					isSelected ? 'text-chrome-text' : 'text-chrome-text-secondary'
				) }
				onClick={ () => {
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			{ showSpinner ? (
				<Tooltip text={ tooltipText }>
					<div className="grid place-items-center">
						<Spinner className="!w-2.5 !h-2.5 !mt-0 !mr-2 [&>circle]:stroke-chrome-text-secondary" />
					</div>
				</Tooltip>
			) : (
				<ButtonToRun { ...site } />
			) }
		</li>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const {
		sites,
		selectedSite,
		setSelectedSiteId,
		startServer,
		stopServer,
		setIsEditModalOpen,
		copySite,
		updateSitesSortOrder,
	} = useSiteDetails();
	const { setSelectedTab } = useContentTabs();
	const { handleDeleteSite } = useDeleteSite();
	const { data: editor } = useGetUserEditorQuery();
	const [ draggedSiteId, setDraggedSiteId ] = useState< string | null >( null );
	const [ orderMap, setOrderMap ] = useState< Map< string, number > | null >( null );
	const [ itemHeight, setItemHeight ] = useState( 0 );
	const listRef = useRef< HTMLUListElement >( null );

	const handleDragStart = ( e: React.DragEvent, siteId: string ) => {
		// Measure item height at drag start (safe — this is an event handler, not render)
		const firstItem = listRef.current?.querySelector( 'li' );
		if ( firstItem && listRef.current ) {
			const style = window.getComputedStyle( listRef.current );
			const gap = parseFloat( style.gap ) || 0;
			setItemHeight( firstItem.getBoundingClientRect().height + gap );
		}
		setDraggedSiteId( siteId );
		// Initialize order map: site id → current visual position
		const map = new Map< string, number >();
		sites.forEach( ( site, i ) => map.set( site.id, i ) );
		setOrderMap( map );
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = ( e: React.DragEvent, siteId: string ) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if ( draggedSiteId === null || ! orderMap ) {
			return;
		}

		// Work out target position from cursor vs element midpoint
		const rect = ( e.currentTarget as HTMLElement ).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const targetPos = orderMap.get( siteId ) ?? 0;
		const insertPos = e.clientY < midY ? targetPos : targetPos + 1;

		const draggedPos = orderMap.get( draggedSiteId ) ?? 0;
		if ( draggedPos === insertPos || draggedPos + 1 === insertPos ) {
			return;
		}

		// Build new order: remove dragged, insert at new position
		const ordered = [ ...orderMap.entries() ].sort( ( a, b ) => a[ 1 ] - b[ 1 ] );
		const ids = ordered.map( ( [ id ] ) => id );
		const fromIndex = ids.indexOf( draggedSiteId );
		ids.splice( fromIndex, 1 );
		const toIndex = fromIndex < insertPos ? insertPos - 1 : insertPos;
		ids.splice( toIndex, 0, draggedSiteId );

		const newMap = new Map< string, number >();
		ids.forEach( ( id, i ) => newMap.set( id, i ) );
		setOrderMap( newMap );
	};

	const handleDrop = ( e: React.DragEvent ) => {
		e.preventDefault();
		if ( orderMap ) {
			// Convert order map back to sorted site array
			const ordered = sites
				.map( ( site ) => ( { site, pos: orderMap.get( site.id ) ?? 0 } ) )
				.sort( ( a, b ) => a.pos - b.pos )
				.map( ( { site } ) => site );
			updateSitesSortOrder( ordered ).catch( ( error ) => {
				console.error( 'Failed to save site order:', error );
			} );
		}
		setDraggedSiteId( null );
		setOrderMap( null );
	};

	const handleDragEnd = () => {
		setDraggedSiteId( null );
		setOrderMap( null );
	};

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'site-context-menu-action',
			async ( _, actionData: { action: string; siteId: string } ) => {
				const site = sites.find( ( site ) => site.id === actionData.siteId );
				if ( ! site ) {
					return;
				}

				const ipcApi = getIpcApi();
				switch ( actionData.action ) {
					case 'start':
						void startServer( site );
						break;
					case 'stop':
						void stopServer( site.id );
						break;
					case 'open-site':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '', { autoLogin: false } );
						break;
					case 'open-admin':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '/wp-admin/' );
						break;
					case 'open-finder':
						ipcApi.openLocalPath( site.path );
						break;
					case 'open-editor':
						if ( editor ) {
							void ipcApi.openAppAtPath( editor, site.path );
						}
						break;
					case 'open-terminal':
						void ( async () => {
							try {
								await ipcApi.openTerminalAtPath( site.path );
							} catch ( error ) {
								Sentry.captureException( error );
								alert( __( 'Could not open the terminal.' ) );
							}
						} )();
						break;
					case 'edit-site':
						if ( site.id !== selectedSite?.id ) {
							setSelectedSiteId( site.id );
						}
						setSelectedTab( 'settings' );
						setIsEditModalOpen( true );
						break;
					case 'copy-site':
						void ( async () => {
							try {
								await copySite( site.id );
							} catch ( error ) {
								Sentry.captureException( error );
							}
						} )();
						break;
					case 'delete':
						await handleDeleteSite( site.id, site.name );
						break;
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [
		sites,
		editor,
		selectedSite?.id,
		setSelectedTab,
		setIsEditModalOpen,
		setSelectedSiteId,
		startServer,
		stopServer,
		copySite,
		handleDeleteSite,
	] );

	return (
		<nav
			aria-label={ __( 'Sites' ) }
			style={ {
				scrollbarGutter: 'stable',
			} }
			className={ cx(
				'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5',
				className
			) }
		>
			<ul ref={ listRef } className="flex flex-col gap-0.5">
				{ sites.map( ( site, index ) => {
					const visualPos = orderMap?.get( site.id ) ?? index;
					const offset = ( visualPos - index ) * itemHeight;
					return (
						<SiteItem
							key={ site.id }
							site={ site }
							onDragStart={ ( e ) => handleDragStart( e, site.id ) }
							onDragOver={ ( e ) => handleDragOver( e, site.id ) }
							onDrop={ handleDrop }
							onDragEnd={ handleDragEnd }
							isDragging={ site.id === draggedSiteId }
							offset={ offset }
						/>
					);
				} ) }
			</ul>
		</nav>
	);
}
