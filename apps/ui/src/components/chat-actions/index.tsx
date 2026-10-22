import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { useEffect, useEffectEvent, useState } from 'react';
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
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { chatPinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { archiveIcon, pinIcon, readStatusIcon, renameIcon, unpinIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

export const getArchiveBlockedReason = () =>
	__( 'Wait for active chats and queued prompts to finish.' );

export function useChatActions( session: AiSessionSummary, active: boolean ) {
	const navigate = useNavigate();
	const working = useSiteAgentActivity( [ session.id ] ) === 'working';
	const archiveBlocked = useSessionsBusy( [ session.id ] );
	const { mutateAsync } = useUpdateSessionMetadata();
	const { data: sites } = useSites();
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
				onClick: () => mutateAsync( { sessionId: session.id, patch: { archived: false } } ),
			},
		} );
		// Leaving the archived chat lands on a new chat for its site.
		const site = findAiSessionOwnerSite( sites, session );
		if ( active ) {
			void navigate(
				site ? { to: '/sites/$siteId/new', params: { siteId: site.id } } : { to: '/' }
			);
		}
	};

	// ⌥⌘R renames, ⌥⌘P pins, ⇧⌘A archives (Ctrl+Alt+R, Ctrl+Alt+P and Ctrl+Shift+A elsewhere).
	const handleShortcut = ( event: KeyboardEvent ) => {
		if ( event.defaultPrevented || event.repeat ) {
			return;
		}
		if ( isKeyboardEvent.primaryAlt( event, 'r' ) ) {
			event.preventDefault();
			setRenaming( true );
		} else if ( isKeyboardEvent.primaryAlt( event, 'p' ) ) {
			event.preventDefault();
			togglePin( chatPinKey( session.id ) );
		} else if ( isKeyboardEvent.primaryShift( event, 'a' ) && ! archiveBlocked ) {
			event.preventDefault();
			void archive();
		}
	};

	return {
		session,
		working,
		archiveBlocked,
		archive,
		handleShortcut,
		pinned: isPinned( chatPinKey( session.id ) ),
		togglePin: () => togglePin( chatPinKey( session.id ) ),
		rename: () => setRenaming( true ),
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
				<Icon icon={ actions.pinned ? unpinIcon : pinIcon } />
				{ actions.pinned ? __( 'Unpin' ) : __( 'Pin' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.rename }>
				<Icon icon={ renameIcon } />
				{ __( 'Rename' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'r' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.toggleRead }>
				<Icon icon={ readStatusIcon } />
				{ actions.session.unread ? __( 'Mark as read' ) : __( 'Mark as unread' ) }
			</Menu.Item>
			<Menu.Separator />
			<Menu.Group>
				{ actions.archiveBlocked ? (
					<Menu.GroupLabel>{ getArchiveBlockedReason() }</Menu.GroupLabel>
				) : null }
				<Menu.Item disabled={ actions.archiveBlocked } onClick={ () => void actions.archive() }>
					<Icon icon={ archiveIcon } />
					{ __( 'Archive' ) }
					<Menu.Shortcut>{ displayShortcut.primaryShift( 'a' ) }</Menu.Shortcut>
				</Menu.Item>
			</Menu.Group>
		</>
	);
}

// The shortcuts act on the open chat unless a dialog has focus.
export function OpenChatShortcuts( { session }: { session: AiSessionSummary } ) {
	const actions = useChatActions( session, true );
	const onKeyDown = useEffectEvent( ( event: KeyboardEvent ) => {
		if ( event.target instanceof Element && event.target.closest( '[role="dialog"]' ) ) {
			return;
		}
		actions.handleShortcut( event );
	} );
	useEffect( () => {
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [] );
	return actions.renameDialog;
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
