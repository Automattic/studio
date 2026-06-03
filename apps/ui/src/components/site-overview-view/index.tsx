import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PreviewSplitContent } from '@/components/preview-split-frame';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SitePreviewToggleButton } from '@/components/site-preview-toggle-button';
import { SiteSettingsForm } from '@/components/site-settings-view';
import { useConnector } from '@/data/core';
import {
	SESSIONS_QUERY_KEY,
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { Composer } from '@/ui-classic/components/session-view/composer';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

export function SiteOverviewView( { siteId }: { siteId: string } ) {
	return (
		<SessionUIProvider>
			<SiteOverviewViewContent siteId={ siteId } />
		</SessionUIProvider>
	);
}

function SiteOverviewViewContent( { siteId }: { siteId: string } ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: sites, isLoading } = useSites();
	const { data: sessions, isLoading: isLoadingSessions } = useSessions();
	const archiveSession = useArchiveSession();
	const unarchiveSession = useUnarchiveSession();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const preview = useSessionPreviewUI();
	const showPreview = preview.open;
	const [ composerBusy, setComposerBusy ] = useState( false );
	const [ composerError, setComposerError ] = useState< string | null >( null );
	const [ settingsOpen, setSettingsOpen ] = useState( false );
	const [ settingsTab, setSettingsTab ] = useState< SiteSettingsTabId >( 'general' );

	const sendNewChatMessage = useCallback(
		async ( prompt: string ) => {
			if ( ! site || composerBusy ) {
				return;
			}
			setComposerBusy( true );
			setComposerError( null );
			try {
				const session = await connector.createSession( site.id );
				await connector.continueSession( session.id, prompt, { displayMessage: prompt } );
				void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
				await navigate( {
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
				} );
			} catch ( error ) {
				const message = error instanceof Error ? error.message : __( 'Could not start chat.' );
				setComposerError( message );
				throw error;
			} finally {
				setComposerBusy( false );
			}
		},
		[ composerBusy, connector, navigate, queryClient, site ]
	);

	useKeyboardShortcut( 'toggle-site-preview', preview.toggle, {
		enabled: !! site,
	} );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading...' ) }</div>;
	}

	if ( ! site ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Site not found' ) }</h1>
				<p>{ siteId }</p>
			</div>
		);
	}

	const siteSessions = [ ...( sessions ?? [] ) ]
		.filter( ( session ) => session.ownerSitePath === site.path )
		.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) );
	const activeSessions = siteSessions.filter( ( session ) => ! session.archived );
	const archivedSessions = siteSessions.filter( ( session ) => session.archived );
	const isUpdatingSession = archiveSession.isPending || unarchiveSession.isPending;

	return (
		<>
			<PreviewSplitContent
				scrollClassName={ styles.scroll }
				composerOuterClassName={ styles.composerOuter }
				header={
					<SiteOverviewHeader
						site={ site }
						previewOpen={ showPreview }
						onTogglePreview={ preview.toggle }
						onOpenSettings={ () => setSettingsOpen( true ) }
					/>
				}
				composer={
					<div className={ styles.classicColumn }>
						<Composer
							busy={ composerBusy }
							error={ composerError }
							model={ DEFAULT_MODEL }
							onSend={ sendNewChatMessage }
							onInterrupt={ async () => undefined }
							autoFocus={ false }
						/>
					</div>
				}
			>
				<div className={ styles.content }>
					<section className={ styles.chats }>
						<header className={ styles.sectionHeader }>
							<h2 className={ styles.sectionTitle }>{ __( 'Chats' ) }</h2>
							<span className={ styles.sectionCount }>
								{ isLoadingSessions
									? __( 'Loading...' )
									: `${ activeSessions.length + archivedSessions.length }` }
							</span>
						</header>
						{ isLoadingSessions ? (
							<p className={ styles.emptyChats }>{ __( 'Loading chats...' ) }</p>
						) : siteSessions.length === 0 ? (
							<p className={ styles.emptyChats }>{ __( 'No chats for this site yet.' ) }</p>
						) : (
							<>
								<ChatSection
									title={ __( 'Active' ) }
									sessions={ activeSessions }
									emptyText={ __( 'No active chats.' ) }
									actionLabel={ __( 'Archive' ) }
									actionDisabled={ isUpdatingSession }
									onAction={ ( session ) => archiveSession.mutate( session ) }
								/>
								<ChatSection
									title={ __( 'Archived' ) }
									sessions={ archivedSessions }
									emptyText={ __( 'No archived chats.' ) }
									actionLabel={ __( 'Unarchive' ) }
									actionDisabled={ isUpdatingSession }
									onAction={ ( session ) => unarchiveSession.mutate( session ) }
								/>
							</>
						) }
					</section>
				</div>
			</PreviewSplitContent>
			<Dialog.Root open={ settingsOpen } onOpenChange={ setSettingsOpen }>
				<Dialog.Popup size="large">
					<Dialog.Header>
						<Dialog.Title>{ __( 'Site settings' ) }</Dialog.Title>
						<Dialog.CloseIcon />
					</Dialog.Header>
					<Dialog.Content>
						<SiteSettingsForm
							site={ site }
							activeTab={ settingsTab }
							onTabChange={ setSettingsTab }
							embedded
						/>
					</Dialog.Content>
				</Dialog.Popup>
			</Dialog.Root>
		</>
	);
}

function SiteOverviewHeader( {
	site,
	previewOpen,
	onTogglePreview,
	onOpenSettings,
}: {
	site: SiteDetails;
	previewOpen: boolean;
	onTogglePreview: () => void;
	onOpenSettings: () => void;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const previewShortcut = getKeyboardShortcutDescriptor(
		getKeyboardShortcut( 'toggle-site-preview' )
	);

	return (
		<div className={ styles.header }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ sidebarCollapsed && ! isFullscreen ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				<SiteDropdown
					site={ site }
					showSiteIcon={ sidebarCollapsed }
					onSettingsClick={ onOpenSettings }
				/>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<div className={ styles.headerActions }>
					<SitePreviewToggleButton
						previewOpen={ previewOpen }
						onTogglePreview={ onTogglePreview }
						shortcut={ previewShortcut }
					/>
				</div>
			</div>
		</div>
	);
}

function ChatSection( {
	title,
	sessions,
	emptyText,
	actionLabel,
	actionDisabled,
	onAction,
}: {
	title: string;
	sessions: AiSessionSummary[];
	emptyText: string;
	actionLabel: string;
	actionDisabled: boolean;
	onAction: ( session: AiSessionSummary ) => void;
} ) {
	return (
		<section className={ styles.chatSection }>
			<div className={ styles.chatSectionHeader }>
				<h3 className={ styles.chatSectionTitle }>{ title }</h3>
				<span className={ styles.chatSectionCount }>{ sessions.length }</span>
			</div>
			{ sessions.length === 0 ? (
				<p className={ styles.emptyChats }>{ emptyText }</p>
			) : (
				<ul className={ styles.chatList }>
					{ sessions.map( ( session ) => (
						<ChatRow
							key={ session.id }
							session={ session }
							actionLabel={ actionLabel }
							actionDisabled={ actionDisabled }
							onAction={ onAction }
						/>
					) ) }
				</ul>
			) }
		</section>
	);
}

function ChatRow( {
	session,
	actionLabel,
	actionDisabled,
	onAction,
}: {
	session: AiSessionSummary;
	actionLabel: string;
	actionDisabled: boolean;
	onAction: ( session: AiSessionSummary ) => void;
} ) {
	const label = session.title?.trim() || session.firstPrompt?.trim() || __( 'Untitled chat' );
	const description = session.description?.trim() || session.assistantReplyPreview?.trim();
	const [ editOpen, setEditOpen ] = useState( false );

	return (
		<li className={ styles.chatRow }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.chatLink }
			>
				<span className={ styles.chatTitle }>{ label }</span>
				<span className={ styles.chatMeta }>
					{ description
						? `${ description } · ${ formatRelativeTime( session.updatedAt ) }`
						: formatRelativeTime( session.updatedAt ) }
				</span>
			</Link>
			<div className={ styles.chatActions }>
				<Button variant="minimal" size="small" onClick={ () => setEditOpen( true ) }>
					{ __( 'Edit' ) }
				</Button>
				<Button
					variant="minimal"
					size="small"
					disabled={ actionDisabled }
					onClick={ () => onAction( session ) }
				>
					{ actionLabel }
				</Button>
			</div>
			<EditChatDetailsDialog session={ session } open={ editOpen } onOpenChange={ setEditOpen } />
		</li>
	);
}

function EditChatDetailsDialog( {
	session,
	open,
	onOpenChange,
}: {
	session: AiSessionSummary;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const updateTitleDescription = useUpdateSessionTitleDescription();
	const generatedTitle = session.generatedTitle ?? session.firstPrompt ?? '';
	const generatedDescription = session.generatedDescription ?? session.assistantReplyPreview ?? '';
	const [ title, setTitle ] = useState( session.userTitle ?? generatedTitle );
	const [ description, setDescription ] = useState(
		session.userDescription ?? generatedDescription
	);

	useEffect( () => {
		if ( open ) {
			setTitle( session.userTitle ?? generatedTitle );
			setDescription( session.userDescription ?? generatedDescription );
		}
	}, [ generatedDescription, generatedTitle, open, session.userDescription, session.userTitle ] );

	const normalizeField = ( value: string ): string | undefined => {
		const trimmed = value.trim();
		return trimmed || undefined;
	};

	const getUserOverride = ( value: string, generatedFallback: string ): string | undefined => {
		const normalized = normalizeField( value );
		if ( ! normalized ) {
			return undefined;
		}
		return normalized === normalizeField( generatedFallback ) ? undefined : normalized;
	};

	const handleSubmit = async ( event: FormEvent ) => {
		event.preventDefault();
		await updateTitleDescription.mutateAsync( {
			sessionId: session.id,
			title: getUserOverride( title, generatedTitle ),
			description: getUserOverride( description, generatedDescription ),
		} );
		onOpenChange( false );
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! updateTitleDescription.isPending ) {
					onOpenChange( next );
				}
			} }
		>
			<Dialog.Popup size="small">
				<form onSubmit={ handleSubmit }>
					<Dialog.Header>
						<Dialog.Title>{ __( 'Edit chat details' ) }</Dialog.Title>
					</Dialog.Header>
					<div className={ styles.dialogFields }>
						<label className={ styles.dialogField }>
							<span>{ __( 'Title' ) }</span>
							<input
								value={ title }
								onChange={ ( event ) => setTitle( event.target.value ) }
								placeholder={ generatedTitle || __( 'Untitled chat' ) }
							/>
						</label>
						<label className={ styles.dialogField }>
							<span>{ __( 'Description' ) }</span>
							<textarea
								value={ description }
								onChange={ ( event ) => setDescription( event.target.value ) }
								placeholder={ generatedDescription || __( 'Add a short description' ) }
								rows={ 3 }
							/>
						</label>
					</div>
					<Dialog.Footer>
						<Dialog.Action
							variant="minimal"
							tone="neutral"
							disabled={ updateTitleDescription.isPending }
						>
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Button
							type="submit"
							variant="solid"
							tone="brand"
							loading={ updateTitleDescription.isPending }
							loadingAnnouncement={ __( 'Saving chat details' ) }
						>
							{ __( 'Save' ) }
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
