import * as Sentry from '@sentry/electron/renderer';
import { speak } from '@wordpress/a11y';
import { Button, Popover, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { archive, chevronRight, Icon, plus } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XDebugIcon } from 'src/components/icons/xdebug-icon';
import { Tooltip } from 'src/components/tooltip';
import { SETUP_SITE_ID } from 'src/constants';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { syncOperationsSelectors } from 'src/stores/sync';
import {
	archiveTaskThunk,
	clearArchivedTasksThunk,
	createNewTask,
	setCreatingProject,
	setSelectedTaskId,
} from 'src/stores/tasks-slice';
import { TaskListItem } from './tasks/task-list-item';
import type { TaskMetadata } from 'src/modules/ai/types';

const PREVIEW_CARD_WIDTH = 260;
const VIEWPORT_PADDING = 8;
const HOVER_SHOW_DELAY = 150;
const HOVER_SKIP_WINDOW = 500;

let lastProjectHideTime = 0;

function ProjectPreviewCard( {
	site,
	taskCount,
	visible,
	mouseX,
	mouseY,
}: {
	site: SiteDetails;
	taskCount: number;
	visible: boolean;
	mouseX: number;
	mouseY: number;
} ) {
	const cardRef = useRef< HTMLDivElement >( null );
	const [ cardHeight, setCardHeight ] = useState( 0 );
	const [ show, setShow ] = useState( false );

	useEffect( () => {
		if ( visible && cardRef.current ) {
			setCardHeight( cardRef.current.offsetHeight );
		}
	}, [ visible ] );

	useEffect( () => {
		if ( visible ) {
			requestAnimationFrame( () => setShow( true ) );
		} else {
			setShow( false );
		}
	}, [ visible ] );

	const position = useMemo( () => {
		let left = mouseX + 16;
		let top = mouseY - 8;

		if ( left + PREVIEW_CARD_WIDTH > window.innerWidth - VIEWPORT_PADDING ) {
			left = mouseX - PREVIEW_CARD_WIDTH - 8;
		}

		const height = cardHeight || 100;
		if ( top + height > window.innerHeight - VIEWPORT_PADDING ) {
			top = window.innerHeight - height - VIEWPORT_PADDING;
		}
		top = Math.max( VIEWPORT_PADDING, top );
		left = Math.max( VIEWPORT_PADDING, left );

		return { top, left };
	}, [ mouseX, mouseY, cardHeight ] );

	if ( ! visible && ! show ) {
		return null;
	}

	return createPortal(
		<div
			ref={ cardRef }
			className={ cx(
				'fixed z-50 pointer-events-none',
				'flex flex-col gap-2 p-3',
				'rounded-lg border border-chrome-border bg-chrome shadow-lg',
				'transition-opacity duration-100 ease-out',
				show ? 'opacity-100' : 'opacity-0'
			) }
			style={ {
				width: PREVIEW_CARD_WIDTH,
				top: position.top,
				left: position.left,
			} }
		>
			<div className="text-sm font-medium text-chrome-text leading-snug">{ site.name }</div>

			<div className="flex flex-col gap-0.5 text-[11px]">
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">Status</span>
					<span
						className={ cx( 'text-chrome-text-secondary', site.running && 'text-a8c-green-20' ) }
					>
						{ site.running ? 'Running' : 'Stopped' }
					</span>
				</div>
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">PHP</span>
					<span className="text-chrome-text-secondary">{ site.phpVersion }</span>
				</div>
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">Tasks</span>
					<span className="text-chrome-text-secondary">{ taskCount }</span>
				</div>
				<div className="flex items-baseline gap-1.5">
					<span className="text-chrome-text-tertiary">Path</span>
					<span className="text-chrome-text-secondary truncate">{ site.path }</span>
				</div>
			</div>
		</div>,
		document.body
	);
}

function StatusIndicator( { site }: { site: SiteDetails } ) {
	const { running, id, name, enableXdebug } = site;
	const { startServer, stopServer, loadingServer } = useSiteDetails();

	useEffect( () => {
		const msg = running
			? __( '%s site started.' ).replace( '%s', name )
			: __( '%s site stopped.' ).replace( '%s', name );
		speak( msg );
	}, [ running, name ] );

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
				onClick={ ( e ) => {
					e.stopPropagation();
					if ( loadingServer[ id ] ) {
						return;
					}
					return running ? stopServer( id ) : startServer( site );
				} }
				className="w-7 h-8 grid place-items-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme group"
				aria-label={
					running
						? __( 'stop %s site' ).replace( '%s', name )
						: __( 'start %s site' ).replace( '%s', name )
				}
			>
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
							'w-2.5 h-2.5 rounded-full transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
							'row-start-1 col-start-1 place-self-center',
							loadingServer[ id ] &&
								'animate-pulse border-a8c-green-20/50 bg-a8c-green-20/50 duration-100',
							running && 'border-a8c-green-20 bg-a8c-green-20 duration-100',
							! running && ! loadingServer[ id ] && 'border-chrome-border bg-chrome-surface'
						) }
					>
						&nbsp;
					</div>
				) }
				{ ! loadingServer[ id ] && (
					<div
						className={ cx(
							'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
							'row-start-1 col-start-1 place-self-center'
						) }
					>
						{ running ? (
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
						) : (
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
						) }
					</div>
				) }
			</button>
		</Tooltip>
	);
}

function ProjectRow( {
	site,
	tasks,
	isExpanded,
	onToggle,
	selectedTaskId,
	onSelectTask,
	onSelectProject,
	onArchiveTask,
	onNewTask,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	isDragging,
	offset,
}: {
	site: SiteDetails;
	tasks: TaskMetadata[];
	isExpanded: boolean;
	onToggle: () => void;
	selectedTaskId: string | null;
	onSelectTask: ( taskId: string ) => void;
	onSelectProject: () => void;
	onArchiveTask: ( taskId: string ) => void;
	onNewTask: () => void;
	onDragStart: ( e: React.DragEvent ) => void;
	onDragOver: ( e: React.DragEvent ) => void;
	onDrop: ( e: React.DragEvent ) => void;
	onDragEnd: () => void;
	isDragging: boolean;
	offset: number;
} ) {
	const { sites, selectedSite, loadingServer } = useSiteDetails();
	const creatingProject = useRootSelector( ( state ) => state.tasks.creatingProject );
	const isSelected = ! selectedTaskId && ! creatingProject && site === selectedSite;
	const { isSiteImporting, isSiteExporting } = useImportExport();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const isImporting = isSiteImporting( site.id );
	const isExporting = isSiteExporting( site.id );
	const isPulling = useRootSelector( syncOperationsSelectors.selectIsSiteIdPulling( site.id ) );
	const isPushing = useRootSelector( syncOperationsSelectors.selectIsSiteIdPushing( site.id ) );
	const isSyncing = isPulling || isPushing;
	const isSiteDeleting = useSiteDetails().isSiteDeleting;
	const isDeleting = isSiteDeleting( site.id );
	const showSpinner =
		site.isAddingSite || isImporting || isPulling || isPushing || isExporting || isDeleting;

	// Hover preview state
	const [ previewVisible, setPreviewVisible ] = useState( false );
	const [ mousePos, setMousePos ] = useState( { x: 0, y: 0 } );
	const timerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	const clearTimer = useCallback( () => {
		if ( timerRef.current ) {
			clearTimeout( timerRef.current );
			timerRef.current = null;
		}
	}, [] );

	const handleMouseEnter = useCallback(
		( e: React.MouseEvent ) => {
			setMousePos( { x: e.clientX, y: e.clientY } );
			clearTimer();
			const elapsed = Date.now() - lastProjectHideTime;
			if ( elapsed < HOVER_SKIP_WINDOW ) {
				setPreviewVisible( true );
			} else {
				timerRef.current = setTimeout( () => setPreviewVisible( true ), HOVER_SHOW_DELAY );
			}
		},
		[ clearTimer ]
	);

	const handleMouseLeave = useCallback( () => {
		clearTimer();
		if ( previewVisible ) {
			lastProjectHideTime = Date.now();
		}
		setPreviewVisible( false );
	}, [ clearTimer, previewVisible ] );

	const handleMouseMove = useCallback( ( e: React.MouseEvent ) => {
		setMousePos( { x: e.clientX, y: e.clientY } );
	}, [] );

	useEffect( () => {
		return () => clearTimer();
	}, [ clearTimer ] );

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
				'flex flex-col rounded-md transition-transform duration-200 ease-in-out',
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
			{ /* Project header row */ }
			<div
				className={ cx(
					'group/row flex items-center pr-1 hover:bg-chrome-surface-hover rounded-md transition-colors',
					isSelected && 'bg-chrome-surface'
				) }
				onMouseEnter={ handleMouseEnter }
				onMouseLeave={ handleMouseLeave }
				onMouseMove={ handleMouseMove }
			>
				<button
					type="button"
					onClick={ onToggle }
					className="flex-shrink-0 w-7 h-8 grid place-items-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				>
					<Icon
						icon={ chevronRight }
						size={ 16 }
						className={ cx(
							'fill-chrome-text-secondary transition-transform duration-200',
							isExpanded ? 'rotate-90' : 'rotate-0'
						) }
					/>
				</button>
				<button
					type="button"
					className="flex-1 min-w-0 text-sm text-left rtl:text-right py-2 pr-1 whitespace-nowrap overflow-hidden text-ellipsis text-chrome-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
					onClick={ onSelectProject }
				>
					{ site.name }
				</button>
				<Tooltip text={ __( 'New task' ) }>
					<button
						type="button"
						onClick={ ( e ) => {
							e.stopPropagation();
							onNewTask();
						} }
						className="flex-shrink-0 w-7 h-8 grid place-items-center opacity-0 group-hover/row:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
						aria-label={ __( 'New task' ) }
					>
						<Icon icon={ plus } size={ 24 } className="fill-chrome-text-secondary" />
					</button>
				</Tooltip>
				{ showSpinner ? (
					<Tooltip text={ tooltipText }>
						<div className="grid place-items-center w-7 h-8">
							<Spinner className="!w-2.5 !h-2.5 !mt-0 [&>circle]:stroke-chrome-text-secondary" />
						</div>
					</Tooltip>
				) : (
					<StatusIndicator site={ site } />
				) }
			</div>

			{ /* Expandable tasks area */ }
			<div
				className={ cx(
					'grid transition-[grid-template-rows] duration-200 ease-in-out',
					isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
				) }
			>
				<div className="overflow-hidden">
					<div className="flex flex-col gap-0.5 pl-5 pt-0.5">
						{ tasks.map( ( task ) => (
							<TaskListItem
								key={ task.id }
								task={ task }
								isSelected={ task.id === selectedTaskId }
								onClick={ () => onSelectTask( task.id ) }
								onArchive={ () => onArchiveTask( task.id ) }
							/>
						) ) }
						{ tasks.length === 0 && (
							<button
								onClick={ onNewTask }
								className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-chrome-text-tertiary hover:text-chrome-text transition-colors rounded-md hover:bg-chrome-surface-hover"
							>
								<Icon icon={ plus } size={ 16 } className="fill-current" />
								<span>New task</span>
							</button>
						) }
					</div>
				</div>
			</div>
			<ProjectPreviewCard
				site={ site }
				taskCount={ tasks.length }
				visible={ previewVisible }
				mouseX={ mousePos.x }
				mouseY={ mousePos.y }
			/>
		</li>
	);
}

export function ProjectList() {
	const dispatch = useAppDispatch();
	const { tasks, selectedTaskId } = useRootSelector( ( state ) => state.tasks );
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
	const [ showArchived, setShowArchived ] = useState( false );
	const [ collapsedSites, setCollapsedSites ] = useState< Set< string > >( new Set() );

	// Drag state
	const [ draggedSiteId, setDraggedSiteId ] = useState< string | null >( null );
	const [ orderMap, setOrderMap ] = useState< Map< string, number > | null >( null );
	const [ itemHeight, setItemHeight ] = useState( 0 );
	const listRef = useRef< HTMLUListElement >( null );

	const siteIds = useMemo( () => new Set( sites.map( ( s ) => s.id ) ), [ sites ] );

	const activeTasks = useMemo(
		() =>
			tasks
				.filter(
					( t ) => ! t.archived && ( siteIds.has( t.siteId ) || t.siteId === SETUP_SITE_ID )
				)
				.sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks, siteIds ]
	);

	const tasksBySite = useMemo( () => {
		const map = new Map< string, TaskMetadata[] >();
		for ( const task of activeTasks ) {
			const existing = map.get( task.siteId );
			if ( existing ) {
				existing.push( task );
			} else {
				map.set( task.siteId, [ task ] );
			}
		}
		return map;
	}, [ activeTasks ] );

	const setupTasks = tasksBySite.get( SETUP_SITE_ID ) ?? [];

	const archivedTasks = useMemo(
		() =>
			tasks
				.filter( ( t ) => t.archived && siteIds.has( t.siteId ) )
				.sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks, siteIds ]
	);

	const toggleSite = useCallback( ( siteId: string ) => {
		setCollapsedSites( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( siteId ) ) {
				next.delete( siteId );
			} else {
				next.add( siteId );
			}
			return next;
		} );
	}, [] );

	const handleArchiveTask = ( taskId: string ) => {
		void dispatch( archiveTaskThunk( taskId ) );
	};

	const handleClearArchived = () => {
		void dispatch( clearArchivedTasksThunk() );
	};

	const handleSelectProject = ( siteId: string ) => {
		dispatch( setSelectedTaskId( null ) );
		setSelectedSiteId( siteId );
	};

	const handleNewTask = ( siteId: string ) => {
		void dispatch( createNewTask( siteId ) );
	};

	// Drag handlers
	const handleDragStart = ( e: React.DragEvent, siteId: string ) => {
		const firstItem = listRef.current?.querySelector( 'li' );
		if ( firstItem && listRef.current ) {
			const style = window.getComputedStyle( listRef.current );
			const gap = parseFloat( style.gap ) || 0;
			setItemHeight( firstItem.getBoundingClientRect().height + gap );
		}
		// Collapse all sites during drag for uniform height
		setCollapsedSites( new Set( sites.map( ( s ) => s.id ) ) );
		setDraggedSiteId( siteId );
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
		const rect = ( e.currentTarget as HTMLElement ).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const targetPos = orderMap.get( siteId ) ?? 0;
		const insertPos = e.clientY < midY ? targetPos : targetPos + 1;
		const draggedPos = orderMap.get( draggedSiteId ) ?? 0;
		if ( draggedPos === insertPos || draggedPos + 1 === insertPos ) {
			return;
		}
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

	// IPC context menu listener
	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'site-context-menu-action',
			async ( _, actionData: { action: string; siteId: string } ) => {
				const site = sites.find( ( s ) => s.id === actionData.siteId );
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
						dispatch( setSelectedTaskId( null ) );
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
		dispatch,
	] );

	return (
		<div className="flex flex-col gap-1">
			<header className="flex items-center justify-between pl-2 pr-0">
				<h3 className="a8c-label text-chrome-text">Projects</h3>
				<div className="flex items-center">
					{ archivedTasks.length > 0 && (
						<div className="relative">
							<Button
								icon={ archive }
								label={ showArchived ? 'Hide archived tasks' : 'Show archived tasks' }
								className={ cx(
									'app-no-drag-region',
									showArchived
										? 'text-chrome-text'
										: 'text-chrome-text-secondary hover:text-chrome-text'
								) }
								onClick={ () => setShowArchived( ! showArchived ) }
							/>
							{ showArchived && (
								<Popover
									placement="bottom-end"
									offset={ 4 }
									noArrow
									onClose={ () => setShowArchived( false ) }
									className="[&>div]:!shadow-none [&>div]:bg-transparent"
								>
									<div className="w-60 rounded-lg bg-chrome-bg border border-chrome-border shadow-lg overflow-hidden">
										<div className="flex items-center justify-between px-3 py-2">
											<span className="text-chrome-text-tertiary text-[10px]">
												{ archivedTasks.length } archived
											</span>
											<button
												onClick={ handleClearArchived }
												className="text-chrome-text-tertiary hover:text-chrome-text text-[10px] transition-colors"
											>
												Clear all
											</button>
										</div>
										<div className="flex flex-col max-h-60 overflow-y-auto">
											{ archivedTasks.map( ( task ) => (
												<TaskListItem
													key={ task.id }
													task={ task }
													isSelected={ task.id === selectedTaskId }
													onClick={ () => {
														dispatch( setSelectedTaskId( task.id ) );
														setShowArchived( false );
													} }
												/>
											) ) }
										</div>
									</div>
								</Popover>
							) }
						</div>
					) }
				</div>
			</header>

			{ /* Setup tasks (no project group) */ }
			{ setupTasks.length > 0 && (
				<div className="flex flex-col gap-0.5">
					{ setupTasks.map( ( task ) => (
						<TaskListItem
							key={ task.id }
							task={ task }
							isSelected={ task.id === selectedTaskId }
							onClick={ () => dispatch( setSelectedTaskId( task.id ) ) }
							onArchive={ () => handleArchiveTask( task.id ) }
						/>
					) ) }
				</div>
			) }

			{ /* Project rows */ }
			<ul ref={ listRef } className="flex flex-col gap-0.5">
				{ sites.map( ( site, index ) => {
					const visualPos = orderMap?.get( site.id ) ?? index;
					const dragOffset = ( visualPos - index ) * itemHeight;
					const siteTasks = tasksBySite.get( site.id ) ?? [];
					return (
						<ProjectRow
							key={ site.id }
							site={ site }
							tasks={ siteTasks }
							isExpanded={ ! collapsedSites.has( site.id ) }
							onToggle={ () => toggleSite( site.id ) }
							selectedTaskId={ selectedTaskId }
							onSelectTask={ ( taskId ) => dispatch( setSelectedTaskId( taskId ) ) }
							onSelectProject={ () => handleSelectProject( site.id ) }
							onArchiveTask={ handleArchiveTask }
							onNewTask={ () => handleNewTask( site.id ) }
							onDragStart={ ( e ) => handleDragStart( e, site.id ) }
							onDragOver={ ( e ) => handleDragOver( e, site.id ) }
							onDrop={ handleDrop }
							onDragEnd={ handleDragEnd }
							isDragging={ site.id === draggedSiteId }
							offset={ dragOffset }
						/>
					);
				} ) }
			</ul>

			{ /* Add project button */ }
			<div className="px-0">
				<Button
					icon={ plus }
					onClick={ () => dispatch( setCreatingProject( true ) ) }
					className={ cx(
						'!w-full !text-xs !px-2 !py-2 !justify-start !rounded-lg',
						'!text-chrome-text-secondary hover:!text-chrome-text'
					) }
					size="compact"
				>
					Add project
				</Button>
			</div>
		</div>
	);
}
