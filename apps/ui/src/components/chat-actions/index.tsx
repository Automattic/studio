import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Dialog, InputControl } from '@wordpress/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import * as Menu from '@/components/menu';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
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

	// ⌥⌘R renames, ⇧⌘A archives (Ctrl+Alt+R and Ctrl+Shift+A elsewhere).
	const handleShortcut = ( event: KeyboardEvent ) => {
		if ( event.defaultPrevented || event.repeat ) {
			return;
		}
		if ( isKeyboardEvent.primaryAlt( event, 'r' ) ) {
			event.preventDefault();
			setRenaming( true );
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
		renameDialog: renaming ? (
			<RenameChatDialog session={ session } onClose={ () => setRenaming( false ) } />
		) : null,
	};
}

type ChatActions = ReturnType< typeof useChatActions >;

export function ChatActionsMenuItems( { actions }: { actions: ChatActions } ) {
	return (
		<>
			<Menu.Item onClick={ actions.togglePin }>
				<Icon icon={ actions.pinned ? unpinIcon : pinIcon } />
				{ actions.pinned ? __( 'Unpin' ) : __( 'Pin' ) }
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

// Mounted while renaming; closing unmounts it.
function RenameChatDialog( {
	session,
	onClose,
}: {
	session: AiSessionSummary;
	onClose: () => void;
} ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const [ title, setTitle ] = useState( () => getSessionTitle( session ) );

	return (
		<Dialog.Root open onOpenChange={ ( next ) => ! next && onClose() }>
			<Dialog.Popup size="small">
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
						<Button type="submit" variant="solid" tone="neutral">
							{ __( 'Save' ) }
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
