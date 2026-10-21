import { aiSessionBelongsToSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate, useParams } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { toast } from '@/data/app-messages';
import { useSiteAgentActivity } from '@/data/queries/use-agent-run';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { archiveIcon, pinIcon, readStatusIcon, unpinIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

// Rows carry their `site:<id>` / `chat:<id>` key, the same keys as pins.
const KEY_ATTRIBUTE = 'data-select-key';

const SelectionContext = createContext< {
	selection: string[] | null;
	clear: () => void;
	deleteSites: ( siteIds: string[] ) => void;
} >( { selection: null, clear: () => {}, deleteSites: () => {} } );

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
 * ⌘/Ctrl-click adds or removes a row, Shift-click selects a range, ⌘/Ctrl+A
 * selects a group, Shift+↑/↓ extends the selection, and Escape clears it.
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
	function select( key: string, range: boolean ) {
		const keys = [ ...new Set( rows().map( ( row ) => row.getAttribute( KEY_ATTRIBUTE )! ) ) ];
		const current = keyOf( root.current?.querySelector( '[aria-current="page"]' ) ?? null );
		const start = anchor.current ?? current;
		if ( range ) {
			const from = start ? keys.indexOf( start ) : -1;
			const to = keys.indexOf( key );
			setSelection(
				from >= 0 ? keys.slice( Math.min( from, to ), Math.max( from, to ) + 1 ) : [ key ]
			);
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
			select( key, event.shiftKey );
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
				<span className={ styles.visuallyHidden } role="status">
					{ selection
						? sprintf(
								/* translators: %d: number of selected sites and chats. */
								_n( '%d item selected', '%d items selected', selection.length ),
								selection.length
						  )
						: '' }
				</span>
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

/** The right-click menu for a multi-row selection. */
export function BulkMenuItems() {
	const { selection, clear, deleteSites } = useContext( SelectionContext );
	const navigate = useNavigate();
	const params = useParams( { strict: false } ) as { sessionId?: string };
	const { data: sessions } = useSessions();
	const { pins, setPins } = useSidebarPins();
	const { mutateAsync, mutate } = useUpdateSessionMetadata();
	const keys = selection ?? [];
	const chatIds = keys
		.filter( ( key ) => key.startsWith( 'chat:' ) )
		.map( ( key ) => key.slice( 5 ) );
	const siteIds = keys
		.filter( ( key ) => key.startsWith( 'site:' ) )
		.map( ( key ) => key.slice( 5 ) );
	const chats = ( sessions ?? [] ).filter( ( session ) => chatIds.includes( session.id ) );
	const working = useSiteAgentActivity( chatIds ) === 'working';
	const allPinned = keys.every( ( key ) => pins.includes( key ) );
	const nonePinned = keys.every( ( key ) => ! pins.includes( key ) );

	// Each chat is updated on its own, so one failure doesn't stop the rest.
	const updateChats = async ( patch: { archived?: boolean; unread?: boolean } ) => {
		const results = await Promise.allSettled(
			chatIds.map( ( sessionId ) => mutateAsync( { sessionId, patch } ) )
		);
		const failed = results.filter( ( result ) => result.status === 'rejected' );
		const done = chatIds.length - failed.length;
		clear();
		if ( failed.length ) {
			toast.error(
				sprintf(
					/* translators: 1: chats updated, 2: chats selected, 3: chats that failed. */
					__( '%1$d of %2$d items updated. %3$d failed.' ),
					done,
					chatIds.length,
					failed.length
				)
			);
		} else if ( patch.archived ) {
			toast.success(
				sprintf(
					/* translators: %d: number of archived chats. */
					_n( '%d chat archived', '%d chats archived', done ),
					done
				),
				{
					action: {
						label: __( 'Undo' ),
						onClick: () =>
							chatIds.forEach( ( sessionId ) =>
								mutate( { sessionId, patch: { archived: false } } )
							),
					},
				}
			);
		}
		if ( patch.archived && params.sessionId && chatIds.includes( params.sessionId ) ) {
			void navigate( { to: '/' } );
		}
	};

	return (
		<>
			{ chatIds.length > 0 ? (
				<>
					<Menu.Item
						disabled={ chats.every( ( chat ) => ! chat.unread ) }
						onClick={ () => void updateChats( { unread: false } ) }
					>
						<Icon icon={ readStatusIcon } />
						{ __( 'Mark as read' ) }
					</Menu.Item>
					<Menu.Item
						disabled={ chats.every( ( chat ) => chat.unread ) }
						onClick={ () => void updateChats( { unread: true } ) }
					>
						<Icon icon={ readStatusIcon } />
						{ __( 'Mark as unread' ) }
					</Menu.Item>
				</>
			) : null }
			<Menu.Item
				disabled={ allPinned }
				onClick={ () => {
					setPins( [ ...keys.filter( ( key ) => ! pins.includes( key ) ), ...pins ] );
					clear();
				} }
			>
				<Icon icon={ pinIcon } />
				{ __( 'Pin' ) }
			</Menu.Item>
			<Menu.Item
				disabled={ nonePinned }
				onClick={ () => {
					setPins( pins.filter( ( pin ) => ! keys.includes( pin ) ) );
					clear();
				} }
			>
				<Icon icon={ unpinIcon } />
				{ __( 'Unpin' ) }
			</Menu.Item>
			<Menu.Separator />
			{ chatIds.length > 0 ? (
				<>
					{ working ? (
						<Menu.GroupLabel>{ __( 'Wait for active chats to finish.' ) }</Menu.GroupLabel>
					) : null }
					<Menu.Item disabled={ working } onClick={ () => void updateChats( { archived: true } ) }>
						<Icon icon={ archiveIcon } />
						{ sprintf(
							/* translators: %d: number of selected chats. */
							_n( 'Archive %d chat', 'Archive %d chats', chatIds.length ),
							chatIds.length
						) }
					</Menu.Item>
				</>
			) : null }
			{ siteIds.length > 0 ? (
				<Menu.Item destructive onClick={ () => deleteSites( siteIds ) }>
					{ sprintf(
						/* translators: %d: number of selected sites. */
						_n( 'Delete %d site', 'Delete %d sites', siteIds.length ),
						siteIds.length
					) }
				</Menu.Item>
			) : null }
		</>
	);
}
