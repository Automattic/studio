import {
	aiSessionBelongsToSite,
	findAiSessionOwnerSite,
} from '@studio/common/ai/sessions/owner-site';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { MaximizeIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
	useSessionsBusy,
	useSessionsNeedingInput,
	useSiteAgentActivity,
} from '@/data/agent-runs/use-agent-run';
import { errorMessage, toast } from '@/data/app-messages';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import {
	chatPinKey,
	orderChats,
	useSidebarPins,
	useSidebarPreferences,
} from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { getSessionTitle } from '@/features/chats/session-view/session-chat-actions';
import { usePreviewBeside, useItemShortcuts } from '@/features/sites';
import {
	ArchiveIcon,
	ExitFullScreenIcon,
	PinIcon,
	ReadStatusIcon,
	RenameIcon,
	UnpinIcon,
} from '@/lib/icons';
import {
	Spinner,
	Menu,
	Input,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Button,
} from '@/lib/ui';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

declare module '@tanstack/react-router' {
	interface HistoryState {
		chatNavigation?: 'recent' | 'pinned' | 'site';
	}
}

export function useLeaveArchivedChat( group?: 'recent' | 'pinned' | 'site' ) {
	const navigate = useNavigate();
	const navigation = useRouterState( { select: ( state ) => state.location.state.chatNavigation } );
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const needingInput = useSessionsNeedingInput();
	const { pins, chatOrder, showRecentChats } = useSidebarPreferences();
	return ( viewing: AiSessionSummary, archivedIds: string[] ) => {
		if ( ( group ?? navigation ) === 'recent' && showRecentChats ) {
			const recent = ( sessions ?? [] )
				.filter(
					( session ) =>
						! session.archived &&
						( session.firstPrompt || session.title || session.id === viewing.id ) &&
						! pins.includes( chatPinKey( session.id ) ) &&
						! needingInput.includes( session.id )
				)
				.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) )
				.slice( 0, 10 );
			const index = recent.findIndex( ( session ) => session.id === viewing.id );
			if ( index !== -1 ) {
				const next = recent
					.slice( index + 1 )
					.concat( recent.slice( 0, index ) )
					.find( ( session ) => ! archivedIds.includes( session.id ) );
				if ( next ) {
					void navigate( {
						to: '/sessions/$sessionId',
						params: { sessionId: next.id },
						state: { chatNavigation: 'recent' },
					} );
					return;
				}
			}
			void navigate( { to: '/' } );
			return;
		}
		const site = findAiSessionOwnerSite( sites, viewing );
		if ( ! site ) {
			void navigate( { to: '/' } );
			return;
		}
		const chats = orderChats(
			( sessions ?? [] ).filter(
				( session ) =>
					!! session.firstPrompt && ! session.archived && aiSessionBelongsToSite( session, site )
			),
			chatOrder[ site.id ]
		).sort(
			( a, b ) =>
				Number( pins.includes( chatPinKey( a.id ) ) ) -
				Number( pins.includes( chatPinKey( b.id ) ) )
		);
		const index = chats.findIndex( ( session ) => session.id === viewing.id );
		const next = chats
			.slice( index + 1 )
			.concat( chats.slice( 0, index ) )
			.find( ( session ) => ! archivedIds.includes( session.id ) );
		void navigate(
			next
				? { to: '/sessions/$sessionId', params: { sessionId: next.id } }
				: { to: '/sites/$siteId/new', params: { siteId: site.id } }
		);
	};
}

export function useChatActions(
	session: AiSessionSummary,
	active: boolean,
	group?: 'recent' | 'pinned' | 'site'
) {
	const working = useSiteAgentActivity( [ session.id ] ) === 'working';
	const archiveBlocked = useSessionsBusy( [ session.id ] );
	const { mutateAsync } = useUpdateSessionMetadata();
	const leaveArchivedChat = useLeaveArchivedChat( group );
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

export function ChatActionsMenuItems( {
	actions,
	children,
}: {
	actions: ChatActions;
	children?: ReactNode;
} ) {
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
			{ children ? (
				<>
					<Menu.Separator />
					{ children }
				</>
			) : null }
			<Menu.Separator />
			<Menu.Item disabled={ actions.archiveBlocked } onClick={ () => void actions.archive() }>
				<ArchiveIcon />
				{ __( 'Archive' ) }
				<Menu.Shortcut>{ displayShortcut.primaryShift( 'a' ) }</Menu.Shortcut>
			</Menu.Item>
		</>
	);
}

// The open chat's pane: right-clicking it opens the chat's actions, except over
// text fields and the transcript, which keep the browser's menu. It wraps the
// pane the same way while the chat loads, so the pane doesn't remount.
export function ChatContextMenu( {
	session,
	canExpand = false,
	children,
}: {
	session?: AiSessionSummary;
	// The site has a preview, which the chat can take the place of.
	canExpand?: boolean;
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
			{ session ? <OpenChatActions session={ session } canExpand={ canExpand } /> : null }
		</Menu.ContextMenuRoot>
	);
}

// The chat shortcuts act on the open chat.
function OpenChatActions( {
	session,
	canExpand,
}: {
	session: AiSessionSummary;
	canExpand: boolean;
} ) {
	const actions = useChatActions( session, true );
	const preview = useOptionalSessionPreviewUI();
	const expanded = ! usePreviewBeside();
	return (
		<>
			<span hidden { ...actions.shortcuts } data-item-shortcuts-active="chat" />
			<Menu.ContextPopup { ...actions.shortcuts }>
				<ChatActionsMenuItems actions={ actions }>
					{ preview && canExpand ? (
						<Menu.Item onClick={ () => preview.setOpen( expanded ) }>
							{ expanded ? <ExitFullScreenIcon /> : <MaximizeIcon /> }
							{ expanded ? __( 'Exit full screen' ) : __( 'Full screen' ) }
						</Menu.Item>
					) : null }
				</ChatActionsMenuItems>
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
			<DialogContent layout="compact">
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
