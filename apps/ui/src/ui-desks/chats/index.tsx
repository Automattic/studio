import { Dialog } from '@base-ui/react/dialog';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useCreateSession, useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { ActionButton, List, ListItem } from '@/ui-desks/components';
import { DeskChatsButton } from '../chrome/chats-button';
import { validateDeskChatsSearch, type DeskChatsSearch } from './search';
import { DeskSessionSurface } from './session-surface';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface DeskChatsProps {
	siteId?: string;
}

function getSessionTitle( session: AiSessionSummary ) {
	return session.firstPrompt?.trim() || __( 'New chat' );
}

function getSessionSubtitle( session: AiSessionSummary ) {
	if ( ! session.firstPrompt ) {
		return __( 'Ask Studio Desk anything to get started.' );
	}

	return formatRelativeTime( session.updatedAt );
}

function useDeskChatsSearch() {
	const search = validateDeskChatsSearch(
		useSearch( { strict: false } ) as Record< string, unknown >
	);
	const navigate = useNavigate();
	const open = search.chats === true;
	const createChatRequestId = search.newChat ?? 0;

	const setOpen = useCallback(
		( nextOpen: boolean ) => {
			void navigate( {
				to: '.',
				search: ( previous: DeskChatsSearch ) => ( {
					...previous,
					chats: nextOpen ? true : undefined,
				} ),
			} );
		},
		[ navigate ]
	);

	return { open, setOpen, createChatRequestId };
}

export function DeskChatsTrigger() {
	const { open, setOpen } = useDeskChatsSearch();

	return <DeskChatsButton open={ open } onToggle={ () => setOpen( ! open ) } />;
}

export function DeskChats( { siteId }: DeskChatsProps ) {
	const { open, setOpen, createChatRequestId } = useDeskChatsSearch();
	const { data: sessions, isFetching: isFetchingSessions } = useSessions();
	const { data: sites } = useSites();
	const isFullscreen = useFullscreen();
	const createSession = useCreateSession();
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const site = siteId ? sites?.find( ( candidate ) => candidate.id === siteId ) : undefined;
	const filteredSessions = siteId
		? site?.path
			? ( sessions ?? [] ).filter( ( session ) => session.ownerSitePath === site.path )
			: []
		: ( sessions ?? [] ).filter( ( session ) => ! session.ownerSitePath );
	const deskSessions = [ ...filteredSessions ].sort(
		( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
	);
	const selectedSession = deskSessions.find( ( session ) => session.id === selectedSessionId );

	useEffect( () => {
		if ( selectedSessionId && sessions && ! isFetchingSessions && ! selectedSession ) {
			setSelectedSessionId( undefined );
			setExpanded( false );
		}
	}, [ isFetchingSessions, selectedSession, selectedSessionId, sessions ] );

	const handleSelectSession = ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( undefined );
	};

	const handleSwitchSession = useCallback( ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( sessionId );
	}, [] );

	const handleNewChat = useCallback( async () => {
		const session = await createSession.mutateAsync( siteId );
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
	}, [ createSession, siteId ] );

	useEffect( () => {
		if ( createChatRequestId === lastCreateChatRequestId.current ) {
			return;
		}

		lastCreateChatRequestId.current = createChatRequestId;
		void handleNewChat();
	}, [ createChatRequestId, handleNewChat ] );

	return (
		<Dialog.Root open={ open } onOpenChange={ setOpen } modal={ false } disablePointerDismissal>
			<Dialog.Portal>
				<Dialog.Popup
					initialFocus={ false }
					finalFocus={ false }
					className={ clsx(
						styles.panel,
						isFullscreen && styles.panelFullscreen,
						motionStyles.motion,
						expanded && styles.panelExpanded
					) }
					aria-label={ __( 'Conversations' ) }
				>
					<div className={ styles.listPane }>
						<header className={ styles.header }>
							<h2>{ __( 'Conversations' ) }</h2>
						</header>
						<List className={ styles.list }>
							{ deskSessions.map( ( session ) => (
								<ListItem
									key={ session.id }
									active={ session.id === selectedSessionId }
									label={ getSessionTitle( session ) }
									description={ getSessionSubtitle( session ) }
									onClick={ () => handleSelectSession( session.id ) }
								/>
							) ) }
						</List>
						<footer className={ styles.footer }>
							<ActionButton
								fullWidth
								disabled={ createSession.isPending }
								aria-busy={ createSession.isPending }
								onClick={ () => void handleNewChat() }
							>
								{ createSession.isPending ? __( 'Creating chat…' ) : __( '+ New chat' ) }
							</ActionButton>
						</footer>
					</div>
					{ expanded ? (
						<div className={ styles.chatPane }>
							{ selectedSessionId ? (
								<DeskSessionSurface
									key={ selectedSessionId }
									siteId={ siteId }
									sessionId={ selectedSessionId }
									onSwitchSession={ handleSwitchSession }
									autoFocus={ autoFocusSessionId === selectedSessionId }
								/>
							) : (
								<div className={ styles.emptyChat }>
									{ __( 'Ask Studio Desk anything to get started.' ) }
								</div>
							) }
						</div>
					) : null }
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
