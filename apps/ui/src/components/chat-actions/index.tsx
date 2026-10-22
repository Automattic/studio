import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Dialog, InputControl } from '@wordpress/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import * as Menu from '@/components/menu';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { Button } from '@/components/ui/button';
import { toast } from '@/data/app-messages';
import { useSiteAgentActivity } from '@/data/queries/use-agent-run';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { chatPinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { archiveIcon, pinIcon, readStatusIcon, renameIcon, unpinIcon } from '@/lib/icons';
import type { AiSessionSummary } from '@/data/core';

export function useChatActions( session: AiSessionSummary, active: boolean ) {
	const navigate = useNavigate();
	const working = useSiteAgentActivity( [ session.id ] ) === 'working';
	const { mutate, mutateAsync } = useUpdateSessionMetadata();
	const [ renaming, setRenaming ] = useState( false );
	const { isPinned, togglePin } = useSidebarPins();

	const archive = async () => {
		await mutateAsync( { sessionId: session.id, patch: { archived: true } } );
		toast.success( __( 'Chat archived' ), {
			action: {
				label: __( 'Undo' ),
				onClick: () => mutate( { sessionId: session.id, patch: { archived: false } } ),
			},
		} );
		// Leaving the archived chat lands on the site's next chat, or a new one.
		if ( active ) {
			void navigate( { to: '/' } );
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
		} else if ( isKeyboardEvent.primaryShift( event, 'a' ) && ! working ) {
			event.preventDefault();
			void archive();
		}
	};

	return {
		session,
		working,
		archive,
		handleShortcut,
		pinned: isPinned( chatPinKey( session.id ) ),
		togglePin: () => togglePin( chatPinKey( session.id ) ),
		rename: () => setRenaming( true ),
		toggleRead: () => mutate( { sessionId: session.id, patch: { unread: ! session.unread } } ),
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
			<Menu.Item disabled={ actions.working } onClick={ () => void actions.archive() }>
				<Icon icon={ archiveIcon } />
				{ __( 'Archive' ) }
				<Menu.Shortcut>{ displayShortcut.primaryShift( 'a' ) }</Menu.Shortcut>
			</Menu.Item>
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
// form remounts on each open, starting from the current title.
function RenameChatDialog( {
	session,
	open,
	onClose,
}: {
	session: AiSessionSummary;
	open: boolean;
	onClose: () => void;
} ) {
	return (
		<Dialog.Root open={ open } onOpenChange={ ( next ) => ! next && onClose() }>
			<Dialog.Popup size="small">
				<RenameChatForm session={ session } onClose={ onClose } />
			</Dialog.Popup>
		</Dialog.Root>
	);
}

function RenameChatForm( {
	session,
	onClose,
}: {
	session: AiSessionSummary;
	onClose: () => void;
} ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const [ title, setTitle ] = useState( () => getSessionTitle( session ) );

	return (
		<form
			onSubmit={ ( event ) => {
				event.preventDefault();
				// An empty name falls back to the chat's first prompt.
				updateSessionMetadata.mutate( {
					sessionId: session.id,
					patch: { title: title.trim() },
				} );
				onClose();
			} }
		>
			<Dialog.Header>
				<Dialog.Title>{ __( 'Rename chat' ) }</Dialog.Title>
				<Dialog.CloseIconButton />
			</Dialog.Header>
			<Dialog.Content>
				<Dialog.Description>
					{ __( 'Choose a name that’s easy to find later.' ) }
				</Dialog.Description>
				<InputControl
					label={ __( 'Chat title' ) }
					hideLabelFromVision
					value={ title }
					onChange={ ( event ) => setTitle( event.target.value ) }
					onFocus={ ( event ) => event.target.select() }
					autoFocus
				/>
			</Dialog.Content>
			<Dialog.Footer>
				<Dialog.Action variant="outline" tone="neutral">
					{ __( 'Cancel' ) }
				</Dialog.Action>
				<Button type="submit">{ __( 'Save' ) }</Button>
			</Dialog.Footer>
		</form>
	);
}
