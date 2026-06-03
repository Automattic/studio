import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { Link } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { archive, code, desktop, external, grid, preformatted } from '@wordpress/icons';
import { Button, Dialog, Icon } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type {
	AiSessionSummary,
	SiteDetails,
	SupportedEditor,
	SupportedTerminal,
} from '@/data/core';
import type { ComponentProps, FormEvent } from 'react';

type ShortcutIcon = ComponentProps< typeof Icon >[ 'icon' ];

interface SiteShortcutAction {
	id: string;
	label: string;
	icon: ShortcutIcon;
	disabled?: boolean;
	run: () => Promise< void >;
}

export function SiteOverviewView( { siteId }: { siteId: string } ) {
	const { data: sites, isLoading } = useSites();
	const { data: sessions, isLoading: isLoadingSessions } = useSessions();
	const { data: userPreferences } = useUserPreferences();
	const startSite = useStartSite();
	const archiveSession = useArchiveSession();
	const unarchiveSession = useUnarchiveSession();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const isStarting = useIsSiteStarting( siteId );
	const isStopping = useIsSiteStopping( siteId );

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
		<div className={ styles.root }>
			<div className={ styles.content }>
				<header className={ styles.header }>
					<div>
						<h1 className={ styles.title }>{ site.name }</h1>
						<p className={ styles.subtitle }>{ getSiteDisplayUrl( site ) }</p>
					</div>
				</header>
				<div className={ styles.details }>
					<Detail
						label={ __( 'Status' ) }
						value={ site.running ? __( 'Running' ) : __( 'Stopped' ) }
					/>
					<Detail label={ __( 'Local URL' ) } value={ getSiteDisplayUrl( site ) } />
					<Detail label={ __( 'Local path' ) } value={ site.path } />
					<Detail label={ __( 'PHP version' ) } value={ site.phpVersion } />
					<Detail
						label={ __( 'WordPress updates' ) }
						value={ site.isWpAutoUpdating === false ? __( 'Pinned' ) : __( 'Automatic' ) }
					/>
				</div>
				<SiteShortcuts
					site={ site }
					editor={ userPreferences?.editor }
					terminal={ userPreferences?.terminal }
					isRuntimeBusy={ isStarting || isStopping || startSite.isPending }
					onStartSite={ () => startSite.mutateAsync( site.id ) }
				/>
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
		</div>
	);
}

function SiteShortcuts( {
	site,
	editor,
	terminal,
	isRuntimeBusy,
	onStartSite,
}: {
	site: SiteDetails;
	editor: SupportedEditor | null | undefined;
	terminal: SupportedTerminal | null | undefined;
	isRuntimeBusy: boolean;
	onStartSite: () => Promise< void >;
} ) {
	const connector = useConnector();
	const [ busyActionId, setBusyActionId ] = useState< string | null >( null );
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );
	const isActionBusy = Boolean( busyActionId );
	const actionDisabled = isRuntimeBusy || isActionBusy;
	const editorLabel = editor ? supportedEditorConfig[ editor ].label : __( 'Editor' );
	const terminalLabel = terminal ? terminalConfig[ terminal ].name : __( 'Terminal' );

	const openSitePath = async (
		path = '',
		options?: Parameters< typeof connector.openSiteUrl >[ 2 ]
	) => {
		if ( ! site.running ) {
			await onStartSite();
		}
		if ( options ) {
			await connector.openSiteUrl( site.id, path, options );
			return;
		}
		await connector.openSiteUrl( site.id, path );
	};

	const actions: SiteShortcutAction[] = [
		{
			id: 'open-site',
			label: __( 'Open site' ),
			icon: external,
			disabled: actionDisabled,
			run: () => openSitePath( '', { autoLogin: false } ),
		},
		{
			id: 'wp-admin',
			label: __( 'WP Admin' ),
			icon: desktop,
			disabled: actionDisabled,
			run: () => openSitePath( '/wp-admin/' ),
		},
		{
			id: 'phpmyadmin',
			label: __( 'phpMyAdmin' ),
			icon: grid,
			disabled: actionDisabled,
			run: () => openSitePath( '/phpmyadmin/index.php?route=/database/structure&db=wordpress' ),
		},
		{
			id: 'files',
			label: getFilesLabel(),
			icon: archive,
			disabled: isActionBusy,
			run: () => connector.openSiteFolder( site.id ),
		},
		{
			id: 'editor',
			label: editorLabel,
			icon: code,
			disabled: isActionBusy || ! editor,
			run: () => connector.openSiteInEditor( site.id ),
		},
		{
			id: 'terminal',
			label: terminalLabel,
			icon: preformatted,
			disabled: isActionBusy,
			run: () => connector.openSiteInTerminal( site.id ),
		},
	];

	const runShortcut = async ( action: SiteShortcutAction ) => {
		if ( action.disabled || busyActionId ) {
			return;
		}
		setBusyActionId( action.id );
		setErrorMessage( null );
		try {
			await action.run();
		} catch ( error ) {
			console.error( 'Failed to run site shortcut:', error );
			setErrorMessage(
				sprintf(
					/* translators: %s: shortcut label, such as "WP Admin". */
					__( 'Could not open %s.' ),
					action.label
				)
			);
		} finally {
			setBusyActionId( null );
		}
	};

	return (
		<section className={ styles.shortcuts }>
			<header className={ styles.sectionHeader }>
				<h2 className={ styles.sectionTitle }>{ __( 'Shortcuts' ) }</h2>
			</header>
			<div className={ styles.shortcutGrid }>
				{ actions.map( ( action ) => (
					<Button
						key={ action.id }
						variant="outline"
						tone="neutral"
						className={ styles.shortcutButton }
						disabled={ action.disabled }
						loading={ busyActionId === action.id }
						loadingAnnouncement={ sprintf(
							/* translators: %s: shortcut label, such as "WP Admin". */
							__( 'Opening %s' ),
							action.label
						) }
						onClick={ () => void runShortcut( action ) }
					>
						<Icon icon={ action.icon } size={ 18 } />
						<span>{ action.label }</span>
					</Button>
				) ) }
			</div>
			{ errorMessage ? <p className={ styles.shortcutError }>{ errorMessage }</p> : null }
		</section>
	);
}

function getFilesLabel() {
	const platform =
		typeof navigator === 'undefined' ? 'MacIntel' : navigator.platform || navigator.userAgent;
	if ( /win/i.test( platform ) ) {
		return __( 'File Explorer' );
	}
	if ( /mac/i.test( platform ) ) {
		return __( 'Finder' );
	}
	return __( 'Files' );
}

function Detail( { label, value }: { label: string; value: string } ) {
	return (
		<div className={ styles.detail }>
			<div className={ styles.detailLabel }>{ label }</div>
			<div className={ styles.detailValue } title={ value }>
				{ value }
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
