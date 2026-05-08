import { Dialog } from '@base-ui/react/dialog';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useCreateSession, useSessions } from '@/data/queries/use-sessions';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { DeskSessionSurface } from './session-surface';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

interface UserDeskChatsProps {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	createChatRequestId: number;
}

interface SiteDeskChatsProps extends UserDeskChatsProps {
	siteId: string;
	sitePath: string | undefined;
}

export type DeskChatsOwner =
	| { type: 'user' }
	| { type: 'site'; siteId: string; sitePath: string | undefined };

interface DeskChatsProps extends UserDeskChatsProps {
	owner: DeskChatsOwner;
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

export function getDeskSessions( sessions: AiSessionSummary[] | undefined, owner: DeskChatsOwner ) {
	const allSessions = sessions ?? [];
	const filteredSessions =
		owner.type === 'site'
			? owner.sitePath
				? allSessions.filter( ( session ) => session.ownerSitePath === owner.sitePath )
				: []
			: allSessions.filter( ( session ) => ! session.ownerSitePath );

	return [ ...filteredSessions ].sort(
		( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
	);
}

function DeskChats( { open, onOpenChange, createChatRequestId, owner }: DeskChatsProps ) {
	const { data: sessions } = useSessions();
	const isFullscreen = useFullscreen();
	const createSession = useCreateSession();
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const deskSessions = useMemo( () => getDeskSessions( sessions, owner ), [ sessions, owner ] );
	const selectedSession = deskSessions.find( ( session ) => session.id === selectedSessionId );

	useEffect( () => {
		if ( selectedSessionId && ! selectedSession ) {
			setSelectedSessionId( undefined );
			setExpanded( false );
		}
	}, [ selectedSession, selectedSessionId ] );

	const handleSelectSession = ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( undefined );
	};

	const handleNewChat = useCallback( async () => {
		const session = await createSession.mutateAsync(
			owner.type === 'site' ? owner.siteId : undefined
		);
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
	}, [ createSession, owner ] );

	useEffect( () => {
		if ( createChatRequestId === lastCreateChatRequestId.current ) {
			return;
		}

		lastCreateChatRequestId.current = createChatRequestId;
		void handleNewChat();
	}, [ createChatRequestId, handleNewChat ] );

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ onOpenChange }
			modal={ false }
			disablePointerDismissal
		>
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
						<div className={ styles.list }>
							{ deskSessions.map( ( session ) => (
								<button
									key={ session.id }
									type="button"
									className={ clsx(
										styles.sessionItem,
										session.id === selectedSessionId && styles.sessionItemActive
									) }
									onClick={ () => handleSelectSession( session.id ) }
								>
									<span className={ styles.sessionTitle }>{ getSessionTitle( session ) }</span>
									<span className={ styles.sessionSubtitle }>
										{ getSessionSubtitle( session ) }
									</span>
								</button>
							) ) }
						</div>
						<footer className={ styles.footer }>
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.newChatButton }
								loading={ createSession.isPending }
								loadingAnnouncement={ __( 'Creating chat' ) }
								onClick={ () => void handleNewChat() }
							>
								{ __( '+ New chat' ) }
							</Button>
						</footer>
					</div>
					{ expanded ? (
						<div className={ styles.chatPane }>
							{ selectedSessionId ? (
								<DeskSessionSurface
									key={ selectedSessionId }
									sessionId={ selectedSessionId }
									onSwitchSession={ setSelectedSessionId }
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

export function UserDeskChats( props: UserDeskChatsProps ) {
	const owner = useMemo< DeskChatsOwner >( () => ( { type: 'user' } ), [] );
	return <DeskChats { ...props } owner={ owner } />;
}

export function SiteDeskChats( { siteId, sitePath, ...props }: SiteDeskChatsProps ) {
	const owner = useMemo< DeskChatsOwner >(
		() => ( { type: 'site', siteId, sitePath } ),
		[ siteId, sitePath ]
	);
	return <DeskChats { ...props } owner={ owner } />;
}
