import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate, useParams } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { displayShortcut, isAppleOS } from '@wordpress/keycodes';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useSessionsBusy } from '@/data/agent-runs/use-agent-run';
import { errorMessage, toast } from '@/data/app-messages';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { chatPinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { getArchiveBlockedReason, useLeaveArchivedChat } from '@/features/chats';
import { useDeleteBlockedReason, DeleteSiteDialog } from '@/features/sites';
import { ArchiveIcon, PinIcon, ReadStatusIcon, TrashIcon, UnpinIcon } from '@/lib/icons';
import { isShortcut } from '@/lib/keyboard';
import { VisuallyHidden, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type {
	KeyboardEvent,
	MouseEvent,
	MouseEventHandler,
	PointerEventHandler,
	ReactNode,
} from 'react';

// Rows carry their `site:<id>` / `chat:<id>` key, the same keys as pins.
const KEY_ATTRIBUTE = 'data-select-key';

const SelectionContext = createContext< {
	selection: string[] | null;
	clear: () => void;
	deleteSites: ( siteIds: string[] ) => void;
} >( { selection: null, clear: () => {}, deleteSites: () => {} } );

/** Whether rows are being multi-selected, which holds off dragging them. */
export function useIsSelecting() {
	return !! useContext( SelectionContext ).selection;
}

/** Props for a selectable row: its key, and whether it's part of the selection. */
export function useSelectableRow( key: string ) {
	const { selection } = useContext( SelectionContext );
	return {
		[ KEY_ATTRIBUTE ]: key,
		'data-selected': selection?.includes( key ) || undefined,
	};
}

/** Whether right-clicking this row should act on a multi-row selection. */
export function useIsBulkTarget( key: string ) {
	const { selection } = useContext( SelectionContext );
	return !! selection && selection.length > 1 && selection.includes( key );
}

function keyOf( target: EventTarget | null ) {
	const row = target instanceof Element ? target.closest( `[${ KEY_ATTRIBUTE }]` ) : null;
	return row?.getAttribute( KEY_ATTRIBUTE ) ?? null;
}

function isEditing( target: EventTarget | null ) {
	return (
		target instanceof Element && !! target.closest( 'input, textarea, select, [role="dialog"]' )
	);
}

/**
 * ⌘/Ctrl-click adds or removes a row, Shift-click selects a range and
 * ⌘/Ctrl+Shift-click adds one, ⌘/Ctrl+A selects a group (or a site's chats),
 * Shift+↑/↓ extends the selection, and Escape clears it.
 */
export function SidebarSelection( { children }: { children: ReactNode } ) {
	const [ selection, setSelection ] = useState< string[] | null >( null );
	const [ deleting, setDeleting ] = useState< string[] | null >( null );
	const anchor = useRef< string | null >( null );
	const root = useRef< HTMLDivElement >( null );
	const navigate = useNavigate();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();

	// Drop rows that went away (archived chats, deleted sites).
	useEffect( () => {
		setSelection( ( current ) => {
			const rendered = new Set( rows().map( ( row ) => row.getAttribute( KEY_ATTRIBUTE ) ) );
			const kept = current?.filter( ( key ) => rendered.has( key ) );
			return kept?.length === current?.length ? current : kept?.length ? kept : null;
		} );
	}, [ sites, sessions ] );

	function rows( scope: Element | null = root.current ) {
		return [ ...( scope?.querySelectorAll( `[${ KEY_ATTRIBUTE }]` ) ?? [] ) ].filter(
			( row ) => ! row.closest( '[inert]' )
		);
	}
	function clear() {
		setSelection( null );
		anchor.current = null;
	}
	function select( key: string, range: boolean, add = false ) {
		const keys = [ ...new Set( rows().map( ( row ) => row.getAttribute( KEY_ATTRIBUTE )! ) ) ];
		// The open chat, not its site row, which is marked current along with it.
		const current = params.sessionId ? chatPinKey( params.sessionId ) : null;
		const start = anchor.current ?? ( current && keys.includes( current ) ? current : null );
		if ( range ) {
			const from = start ? keys.indexOf( start ) : -1;
			const to = keys.indexOf( key );
			const span =
				from >= 0 ? keys.slice( Math.min( from, to ), Math.max( from, to ) + 1 ) : [ key ];
			setSelection( add ? [ ...new Set( [ ...( selection ?? [] ), ...span ] ) ] : span );
			anchor.current ??= from >= 0 ? start : key;
			return;
		}
		const initial = selection ?? ( start ? [ start ] : [] );
		const next = initial.includes( key )
			? initial.filter( ( selected ) => selected !== key )
			: [ ...initial, key ];
		anchor.current = key;
		setSelection( next.length ? next : null );
	}

	function onClickCapture( event: MouseEvent ) {
		const key = keyOf( event.target );
		if ( ! key || isEditing( event.target ) ) {
			return;
		}
		if ( event.metaKey || event.ctrlKey || event.shiftKey ) {
			event.preventDefault();
			event.stopPropagation();
			select( key, event.shiftKey, event.metaKey || event.ctrlKey );
		} else {
			anchor.current = key;
			setSelection( null );
		}
	}

	function onKeyDownCapture( event: KeyboardEvent ) {
		if ( isEditing( event.target ) ) {
			return;
		}
		if ( event.key === 'Escape' && selection ) {
			event.preventDefault();
			clear();
			return;
		}
		const key = keyOf( event.target );
		if (
			key &&
			( event.metaKey || event.ctrlKey ) &&
			! event.shiftKey &&
			! event.altKey &&
			event.key.toLowerCase() === 'a'
		) {
			const group = ( event.target as Element ).closest( '[role="group"]' );
			event.preventDefault();
			setSelection( [
				...new Set( rows( group ).map( ( row ) => row.getAttribute( KEY_ATTRIBUTE )! ) ),
			] );
			return;
		}
		if ( key && event.shiftKey && ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) ) {
			const all = rows();
			const index = all.findIndex( ( row ) => row.contains( event.target as Node ) );
			const next = all[ index + ( event.key === 'ArrowDown' ? 1 : -1 ) ];
			if ( next ) {
				event.preventDefault();
				anchor.current ??= key;
				select( next.getAttribute( KEY_ATTRIBUTE )!, true );
				next.querySelector< HTMLElement >( 'button' )?.focus();
			}
		}
	}

	const deletingSites = ( sites ?? [] ).filter( ( site ) => deleting?.includes( site.id ) );
	const viewing = sessions?.find( ( session ) => session.id === params.sessionId );

	return (
		<SelectionContext.Provider value={ { selection, clear, deleteSites: setDeleting } }>
			<div
				ref={ root }
				className={ styles.selection }
				data-selecting={ selection ? true : undefined }
				onClickCapture={ onClickCapture }
				onKeyDownCapture={ onKeyDownCapture }
				onContextMenuCapture={ ( event ) => {
					const key = keyOf( event.target );
					if ( key && ! selection?.includes( key ) ) {
						clear();
					}
				} }
			>
				{ children }
				<VisuallyHidden role="status">
					{ selection ? describeSelection( selection ) : '' }
				</VisuallyHidden>
			</div>
			<DeleteSiteDialog
				sites={ deletingSites }
				open={ deletingSites.length > 0 }
				onOpenChange={ ( open ) => ! open && setDeleting( null ) }
				onDeleted={ () => {
					const viewingDeleted = deletingSites.some(
						( site ) =>
							site.id === params.siteId || ( viewing && aiSessionBelongsToSite( viewing, site ) )
					);
					clear();
					if ( viewingDeleted ) {
						void navigate( { to: '/' } );
					}
				} }
			/>
		</SelectionContext.Provider>
	);
}

function describeSelection( selection: string[] ) {
	const count = selection.length;
	if ( selection.every( ( key ) => key.startsWith( 'chat:' ) ) ) {
		/* translators: %d: number of selected chats. */
		return sprintf( _n( '%d chat selected', '%d chats selected', count ), count );
	}
	if ( selection.every( ( key ) => key.startsWith( 'site:' ) ) ) {
		/* translators: %d: number of selected sites. */
		return sprintf( _n( '%d site selected', '%d sites selected', count ), count );
	}
	/* translators: %d: number of selected sites and chats. */
	return sprintf( _n( '%d item selected', '%d items selected', count ), count );
}

function itemsUpdated( count: number ) {
	/* translators: %d: number of sites and chats updated. */
	return sprintf( _n( '%d item updated', '%d items updated', count ), count );
}

/**
 * The right-click menu for a multi-row selection. Its shortcuts act on every
 * selected row: ⌥⌘P pins or unpins, ⇧⌘A archives, ⌘⌫ deletes the sites.
 */
export function BulkMenu( {
	onClose,
	onClick,
	onPointerDown,
}: {
	onClose: () => void;
	onClick?: MouseEventHandler< HTMLElement >;
	onPointerDown?: PointerEventHandler< HTMLElement >;
} ) {
	const { selection, clear, deleteSites } = useContext( SelectionContext );
	const params = useParams( { strict: false } ) as { sessionId?: string };
	const { data: sessions } = useSessions();
	const { data: sites } = useSites();
	const { pins, setPins } = useSidebarPins();
	const { mutateAsync } = useUpdateSessionMetadata();
	const leaveArchivedChat = useLeaveArchivedChat();
	const keys = selection ?? [];
	const chatIds = keys
		.filter( ( key ) => key.startsWith( 'chat:' ) )
		.map( ( key ) => key.slice( 5 ) );
	const siteIds = keys
		.filter( ( key ) => key.startsWith( 'site:' ) )
		.map( ( key ) => key.slice( 5 ) );
	const chats = ( sessions ?? [] ).filter( ( session ) => chatIds.includes( session.id ) );
	const selectedSites = ( sites ?? [] ).filter( ( site ) => siteIds.includes( site.id ) );
	const archiveBlocked = useSessionsBusy( chatIds );
	const deleteBlocked = useDeleteBlockedReason(
		selectedSites,
		selectedSites.some( ( site ) => site.operation )
	);
	const allPinned = keys.every( ( key ) => pins.includes( key ) );
	const nonePinned = keys.every( ( key ) => ! pins.includes( key ) );

	const setPinned = ( pinned: boolean ) => {
		onClose();
		const changed = keys.filter( ( key ) => pins.includes( key ) !== pinned );
		setPins(
			pinned ? [ ...pins, ...changed ] : pins.filter( ( pin ) => ! changed.includes( pin ) )
		);
		clear();
		toast.success( itemsUpdated( changed.length ) );
	};

	// Each chat is updated on its own, so one failure doesn't stop the rest.
	const updateChats = async ( patch: { archived?: boolean; unread?: boolean } ) => {
		onClose();
		const results = await Promise.allSettled(
			chatIds.map( ( sessionId ) => mutateAsync( { sessionId, patch } ) )
		);
		const updated = chatIds.filter( ( _, index ) => results[ index ].status === 'fulfilled' );
		const errors = results.flatMap( ( result ) =>
			result.status === 'rejected' ? [ errorMessage( result.reason ) ] : []
		);
		clear();
		const undo =
			patch.archived && updated.length
				? {
						label: __( 'Undo' ),
						once: true,
						onClick: () =>
							Promise.all(
								updated.map( ( sessionId ) =>
									mutateAsync( { sessionId, patch: { archived: false } } )
								)
							),
				  }
				: undefined;
		if ( errors.length ) {
			toast.error(
				sprintf(
					/* translators: 1: chats updated, 2: chats selected, 3: chats that failed. */
					__( '%1$d of %2$d items updated. %3$d failed.' ),
					updated.length,
					chatIds.length,
					errors.length
				),
				{ description: [ ...new Set( errors ) ].join( '\n' ), action: undo }
			);
		} else {
			toast.success(
				patch.archived
					? sprintf(
							/* translators: %d: number of archived chats. */
							_n( '%d chat archived', '%d chats archived', updated.length ),
							updated.length
					  )
					: itemsUpdated( updated.length ),
				{ action: undo }
			);
		}
		const viewing = sessions?.find( ( session ) => session.id === params.sessionId );
		if ( patch.archived && viewing && updated.includes( viewing.id ) ) {
			leaveArchivedChat( viewing, updated );
		}
	};

	const confirmDelete = () => {
		onClose();
		deleteSites( siteIds );
	};

	const handleShortcut = ( event: KeyboardEvent ) => {
		if ( event.repeat ) {
			return;
		}
		const native = event.nativeEvent;
		if ( isShortcut( native, 'p', 'alt' ) ) {
			event.preventDefault();
			setPinned( ! allPinned );
		} else if ( isShortcut( native, 'a', 'shift' ) && chatIds.length && ! archiveBlocked ) {
			event.preventDefault();
			void updateChats( { archived: true } );
		} else if ( isShortcut( native, 'Backspace' ) && siteIds.length && ! deleteBlocked ) {
			event.preventDefault();
			confirmDelete();
		}
	};

	return (
		<Menu.ContextPopup
			onKeyDown={ handleShortcut }
			onClick={ onClick }
			onPointerDown={ onPointerDown }
		>
			{ chatIds.length > 0 ? (
				<>
					<Menu.Item
						disabled={ chats.every( ( chat ) => ! chat.unread ) }
						onClick={ () => void updateChats( { unread: false } ) }
					>
						<ReadStatusIcon />
						{ __( 'Mark as read' ) }
					</Menu.Item>
					<Menu.Item
						disabled={ chats.every( ( chat ) => chat.unread ) }
						onClick={ () => void updateChats( { unread: true } ) }
					>
						<ReadStatusIcon />
						{ __( 'Mark as unread' ) }
					</Menu.Item>
				</>
			) : null }
			<Menu.Item disabled={ allPinned } onClick={ () => setPinned( true ) }>
				<PinIcon />
				{ __( 'Pin' ) }
				{ allPinned ? null : <Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut> }
			</Menu.Item>
			<Menu.Item disabled={ nonePinned } onClick={ () => setPinned( false ) }>
				<UnpinIcon />
				{ __( 'Unpin' ) }
				{ allPinned ? <Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut> : null }
			</Menu.Item>
			<Menu.Separator />
			{ chatIds.length > 0 ? (
				<Menu.Group>
					{ archiveBlocked ? (
						<Menu.GroupLabel>{ getArchiveBlockedReason() }</Menu.GroupLabel>
					) : null }
					<Menu.Item
						disabled={ archiveBlocked }
						onClick={ () => void updateChats( { archived: true } ) }
					>
						<ArchiveIcon />
						{ sprintf(
							/* translators: %d: number of selected chats. */
							_n( 'Archive %d chat', 'Archive %d chats', chatIds.length ),
							chatIds.length
						) }
						<Menu.Shortcut>{ displayShortcut.primaryShift( 'a' ) }</Menu.Shortcut>
					</Menu.Item>
				</Menu.Group>
			) : null }
			{ siteIds.length > 0 ? (
				<Menu.Group>
					{ deleteBlocked ? <Menu.GroupLabel>{ deleteBlocked }</Menu.GroupLabel> : null }
					<Menu.Item destructive disabled={ !! deleteBlocked } onClick={ confirmDelete }>
						<TrashIcon />
						{ sprintf(
							/* translators: %d: number of selected sites. */
							_n( 'Delete %d site', 'Delete %d sites', siteIds.length ),
							siteIds.length
						) }
						<Menu.Shortcut>
							{ displayShortcut.primary( isAppleOS() ? '⌫' : 'Backspace' ) }
						</Menu.Shortcut>
					</Menu.Item>
				</Menu.Group>
			) : null }
		</Menu.ContextPopup>
	);
}
