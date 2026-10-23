import {
	aiSessionBelongsToSite,
	findAiSessionOwnerSite,
} from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { useState, type ReactNode } from 'react';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import * as Menu from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, toast } from '@/data/app-messages';
import { useSessionsBusy, useSiteAgentActivity } from '@/data/queries/use-agent-run';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import {
	chatPinKey,
	orderChats,
	useSidebarPins,
	useSidebarPreferences,
} from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { useItemShortcuts } from '@/hooks/use-item-shortcuts';
import { ArchiveIcon } from '@/lib/icons/archive-icon';
import { PinIcon } from '@/lib/icons/pin-icon';
import { ReadStatusIcon } from '@/lib/icons/read-status-icon';
import { RenameIcon } from '@/lib/icons/rename-icon';
import { UnpinIcon } from '@/lib/icons/unpin-icon';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

export const getArchiveBlockedReason = () =>
	__( 'Wait for active chats and queued prompts to finish.' );

/**
 * Leaves an open chat that was just archived for the top chat still listed
 * under its site, then one of the site's pinned chats, or a new chat when none
 * is left.
 */
export function useLeaveArchivedChat() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const { pins, chatOrder } = useSidebarPreferences();
	return ( viewing: AiSessionSummary, archivedIds: string[] ) => {
		const site = findAiSessionOwnerSite( sites, viewing );
		if ( ! site ) {
			void navigate( { to: '/' } );
			return;
		}
		const [ next ] = orderChats(
			( sessions ?? [] ).filter(
				( session ) =>
					! session.archived &&
					! archivedIds.includes( session.id ) &&
					aiSessionBelongsToSite( session, site )
			),
			chatOrder[ site.id ]
		).sort(
			( a, b ) =>
				Number( pins.includes( chatPinKey( a.id ) ) ) -
				Number( pins.includes( chatPinKey( b.id ) ) )
		);
		void navigate(
			next
				? { to: '/sessions/$sessionId', params: { sessionId: next.id } }
				: { to: '/sites/$siteId/new', params: { siteId: site.id } }
		);
	};
}

export function useChatActions( session: AiSessionSummary, active: boolean ) {
	const working = useSiteAgentActivity( [ session.id ] ) === 'working';
	const archiveBlocked = useSessionsBusy( [ session.id ] );
	const { mutateAsync } = useUpdateSessionMetadata();
	const leaveArchivedChat = useLeaveArchivedChat();
	const [ renaming, setRenaming ] = useState( false );
	const { isPinned, togglePin } = useSidebarPins();

	const update = ( patch: { archived?: boolean; unread?: boolean }, failure: string ) =>
		mutateAsync( { sessionId: session.id, patch } ).then(
			() => true,
			( error ) => {
				toast.error( failure, { description: errorMessage( error ) } );
				return false;
			}
		);

	const archive = async () => {
		if (
			archiveBlocked ||
			! ( await update( { archived: true }, __( 'Couldn’t archive the chat' ) ) )
		) {
			return;
		}
		toast.success( __( 'Chat archived' ), {
			action: {
				label: __( 'Undo' ),
				once: true,
				onClick: () => mutateAsync( { sessionId: session.id, patch: { archived: false } } ),
			},
		} );
		if ( active ) {
			leaveArchivedChat( session, [ session.id ] );
		}
	};

	const togglePinned = () => togglePin( chatPinKey( session.id ) );
	const rename = () => setRenaming( true );
	const shortcuts = useItemShortcuts( {
		rename,
		pin: togglePinned,
		archive: archiveBlocked ? undefined : () => void archive(),
	} );

	return {
		session,
		working,
		archiveBlocked,
		archive,
		shortcuts,
		pinned: isPinned( chatPinKey( session.id ) ),
		togglePin: togglePinned,
		rename,
		toggleRead: () => void update( { unread: ! session.unread }, __( 'Couldn’t update the chat' ) ),
		renameDialog: (
			<RenameChatDialog
				session={ session }
				open={ renaming }
				onClose={ () => setRenaming( false ) }
			/>
		),
	};
}

type ChatActions = ReturnType< typeof useChatActions >;

export function ChatActionsMenuItems( { actions }: { actions: ChatActions } ) {
	return (
		<>
			<Menu.Item onClick={ actions.togglePin }>
				{ actions.pinned ? <UnpinIcon /> : <PinIcon /> }
				{ actions.pinned ? __( 'Unpin' ) : __( 'Pin' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.rename }>
				<RenameIcon />
				{ __( 'Rename' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'r' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.toggleRead }>
				<ReadStatusIcon />
				{ actions.session.unread ? __( 'Mark as read' ) : __( 'Mark as unread' ) }
			</Menu.Item>
			<Menu.Separator />
			<Menu.Group>
				{ actions.archiveBlocked ? (
					<Menu.GroupLabel>{ getArchiveBlockedReason() }</Menu.GroupLabel>
				) : null }
				<Menu.Item disabled={ actions.archiveBlocked } onClick={ () => void actions.archive() }>
					<ArchiveIcon />
					{ __( 'Archive' ) }
					<Menu.Shortcut>{ displayShortcut.primaryShift( 'a' ) }</Menu.Shortcut>
				</Menu.Item>
			</Menu.Group>
		</>
	);
}

// The open chat's pane: right-clicking it opens the chat's actions, except over
// text fields and the transcript, which keep the browser's menu. It wraps the
// pane the same way while the chat loads, so the pane doesn't remount.
export function ChatContextMenu( {
	session,
	children,
}: {
	session?: AiSessionSummary;
	children: ReactNode;
} ) {
	return (
		<Menu.ContextMenuRoot disabled={ ! session }>
			<Menu.ContextMenuTrigger
				className={ styles.pane }
				onContextMenuCapture={ ( event ) => {
					if (
						( event.target as Element ).closest(
							'input, textarea, [contenteditable="true"], [data-chat-transcript]'
						)
					) {
						event.stopPropagation();
					}
				} }
			>
				{ children }
			</Menu.ContextMenuTrigger>
			{ session ? <OpenChatActions session={ session } /> : null }
		</Menu.ContextMenuRoot>
	);
}

// The chat shortcuts act on the open chat.
function OpenChatActions( { session }: { session: AiSessionSummary } ) {
	const actions = useChatActions( session, true );
	return (
		<>
			<span hidden { ...actions.shortcuts } data-item-shortcuts-active="chat" />
			<Menu.ContextPopup { ...actions.shortcuts }>
				<ChatActionsMenuItems actions={ actions } />
			</Menu.ContextPopup>
			{ actions.renameDialog }
		</>
	);
}

// Stays mounted so it animates open and closed like the other dialogs; the
// form remounts on each open, starting from the current title. It stays open
// while the new name saves, and on a failure.
function RenameChatDialog( {
	session,
	open,
	onClose,
}: {
	session: AiSessionSummary;
	open: boolean;
	onClose: () => void;
} ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const saving = updateSessionMetadata.isPending;
	const save = ( title: string ) =>
		// An empty name falls back to the chat's first prompt.
		updateSessionMetadata.mutate(
			{ sessionId: session.id, patch: { title: title.trim() } },
			{
				onSuccess: onClose,
				onError: ( error ) =>
					toast.error( __( 'Couldn’t rename the chat' ), { description: errorMessage( error ) } ),
			}
		);
	return (
		<Dialog open={ open } onOpenChange={ ( next ) => ! next && ! saving && onClose() }>
			<DialogContent>
				<RenameChatForm session={ session } saving={ saving } onSave={ save } />
			</DialogContent>
		</Dialog>
	);
}

function RenameChatForm( {
	session,
	saving,
	onSave,
}: {
	session: AiSessionSummary;
	saving: boolean;
	onSave: ( title: string ) => void;
} ) {
	const [ title, setTitle ] = useState( () => getSessionTitle( session ) );

	return (
		<form
			className={ styles.form }
			onSubmit={ ( event ) => {
				event.preventDefault();
				onSave( title );
			} }
		>
			<DialogHeader>
				<DialogTitle>{ __( 'Rename chat' ) }</DialogTitle>
				<DialogDescription>{ __( 'Choose a name that’s easy to find later.' ) }</DialogDescription>
			</DialogHeader>
			<Input
				aria-label={ __( 'Chat title' ) }
				value={ title }
				disabled={ saving }
				onChange={ ( event ) => setTitle( event.target.value ) }
				onFocus={ ( event ) => event.target.select() }
				autoFocus
			/>
			<DialogFooter>
				<DialogClose render={ <Button variant="outline" /> } disabled={ saving }>
					{ __( 'Cancel' ) }
				</DialogClose>
				<Button type="submit" disabled={ saving }>
					{ saving ? <Spinner aria-hidden="true" /> : null }
					{ __( 'Save' ) }
				</Button>
			</DialogFooter>
		</form>
	);
}
