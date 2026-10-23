import { Autocomplete } from '@base-ui/react/autocomplete';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { cloudUpload, copy, Icon, search, seen, unseen, wordpress } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { setAnnotating, useSiteAnnotations } from '@/components/annotations/store';
import { useChatActions } from '@/components/chat-actions';
import { openNoticeHistory } from '@/components/notice-history';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { getSections } from '@/components/settings-dialog/sections';
import { useSiteActions } from '@/components/site-actions-menu';
import { useCollapseAll } from '@/components/site-list/collapse-all';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSessions } from '@/data/queries/use-sessions';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setCommandPaletteOpen, useCommandPaletteOpen } from '@/hooks/use-command-palette';
import { useOpenAddSite } from '@/hooks/use-open-add-site';
import { useOpenHeaderPanel } from '@/hooks/use-open-header-panel';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { useOpenSite } from '@/hooks/use-open-site';
import { useSessionUIDispatch, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarOpen, useToggleSidebar } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { getSiteUrl } from '@/lib/get-site-url';
import {
	annotateIcon,
	archiveIcon,
	bellIcon,
	chatIcon,
	collapseAllIcon,
	databaseIcon,
	globeIcon,
	newChatIcon,
	pinIcon,
	plusIcon,
	refreshIcon,
	renameIcon,
	settingsIcon,
	shareIcon,
	sidebarExpandedIcon,
	startSiteIcon,
	stopSiteIcon,
	unpinIcon,
} from '@/lib/icons';
import { isDialogOpen, isShortcut } from '@/lib/shortcuts';
import { DEFAULT_COLOR_TINT } from '@/lib/theme';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails, UserPreferences } from '@/data/core';
import type { ReactElement } from 'react';

const GROUPS = [
	'quick',
	'recent',
	'site',
	'chat',
	'site-settings',
	'settings',
	'commands',
	'sites',
	'chats',
] as const;
type GroupId = ( typeof GROUPS )[ number ];

type PaletteCommand = {
	id: string;
	group: GroupId;
	label: string;
	icon: ReactElement;
	description?: string;
	// Other names, ranked like the label.
	aliases?: string[];
	keywords?: string[];
	// Orders commands within a group; lower comes first.
	priority?: number;
	// Recent chats show only before typing; every chat only while searching.
	browseOnly?: boolean;
	searchOnly?: boolean;
	run: () => void;
};

const RECENT_CHATS_LIMIT = 5;

function getGroupLabel( group: GroupId ) {
	return {
		quick: __( 'Quick actions' ),
		recent: __( 'Recent' ),
		site: __( 'Site actions' ),
		chat: __( 'Chat actions' ),
		'site-settings': __( 'Site settings' ),
		settings: __( 'Settings' ),
		commands: __( 'Commands' ),
		sites: __( 'Sites' ),
		chats: __( 'Chats' ),
	}[ group ];
}

const byPriority = ( a: PaletteCommand, b: PaletteCommand ) =>
	( a.priority ?? 0 ) - ( b.priority ?? 0 );

const normalize = ( value: string ) => value.trim().toLocaleLowerCase().replace( /\s+/g, ' ' );

// Commands whose label or an alias contains every typed word rank above those
// matching only through keywords; groups are ordered by their best match.
export function matchCommands( commands: PaletteCommand[], query: string ) {
	const words = normalize( query ).split( ' ' ).filter( Boolean );
	if ( ! words.length ) {
		return commands
			.filter( ( command ) => ! command.searchOnly )
			.sort(
				( a, b ) => GROUPS.indexOf( a.group ) - GROUPS.indexOf( b.group ) || byPriority( a, b )
			);
	}
	const scored = commands
		.filter( ( command ) => ! command.browseOnly )
		.map( ( command ) => {
			const names = [ command.label, ...( command.aliases ?? [] ) ].map( normalize );
			const terms = [ ...names, ...( command.keywords ?? [] ).map( normalize ) ];
			const score = names.includes( words.join( ' ' ) )
				? 3
				: names.some( ( name ) => words.every( ( word ) => name.includes( word ) ) )
				? 2
				: words.every( ( word ) => terms.some( ( term ) => term.includes( word ) ) )
				? 1
				: 0;
			return { command, score };
		} )
		.filter( ( match ) => match.score > 0 );
	const best = new Map< GroupId, number >();
	for ( const { command, score } of scored ) {
		best.set( command.group, Math.max( best.get( command.group ) ?? 0, score ) );
	}
	return scored
		.sort(
			( a, b ) =>
				best.get( b.command.group )! - best.get( a.command.group )! ||
				GROUPS.indexOf( a.command.group ) - GROUPS.indexOf( b.command.group ) ||
				b.score - a.score ||
				byPriority( a.command, b.command )
		)
		.map( ( match ) => match.command );
}

/**
 * ⌘K (Ctrl+K elsewhere) searches sites, chats and the commands for the current
 * site and chat.
 */
export function CommandPalette( {
	site,
	session,
	chatHidden,
}: {
	site?: SiteDetails;
	session?: AiSessionSummary;
	// Set where the chat can be hidden beside the preview.
	chatHidden?: boolean;
} ) {
	const open = useCommandPaletteOpen();
	const commands = useAppCommands();

	// Settings and Add site hand ⌘K over themselves; other dialogs keep it.
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.defaultPrevented || event.repeat || ! isShortcut( event, 'k' ) ) {
				return;
			}
			if ( ! open && isDialogOpen() ) {
				return;
			}
			event.preventDefault();
			setCommandPaletteOpen( ! open );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ open ] );

	const palette = { open, onOpenChange: setCommandPaletteOpen, commands };
	return site ? (
		<SiteCommands
			key={ site.id }
			site={ site }
			session={ session }
			chatHidden={ chatHidden }
			{ ...palette }
		/>
	) : (
		<PaletteDialog { ...palette } />
	);
}

type PaletteProps = {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	commands: PaletteCommand[];
};

function useAppCommands(): PaletteCommand[] {
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const openAddSite = useOpenAddSite();
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const { chatEnabled } = useAgenticFeatures();
	const openSite = useOpenSite();
	const sidebarOpen = useSidebarOpen();
	const toggleSidebar = useToggleSidebar();
	const colorScheme = useColorScheme();
	const savePreferences = useSaveUserPreferences();
	const collapseAll = useCollapseAll();
	const settingCommands = useSettingCommands( 'studio' );

	const chats = chatEnabled
		? ( sessions ?? [] )
				.filter( ( session ) => ! session.archived )
				.map( ( session ) => ( { session, site: findAiSessionOwnerSite( sites, session ) } ) )
				.filter( ( chat ) => !! chat.site )
				.sort(
					( a, b ) =>
						( Date.parse( b.session.updatedAt ) || 0 ) - ( Date.parse( a.session.updatedAt ) || 0 )
				)
		: [];
	const chatCommand = ( { session, site }: ( typeof chats )[ number ] ) => ( {
		label: getSessionTitle( session ),
		icon: chatIcon,
		description: site!.name,
		run: () => void navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } ),
	} );

	return [
		{
			id: 'new-site',
			group: 'quick',
			label: __( 'New site' ),
			icon: plusIcon,
			aliases: [ __( 'Add site' ), __( 'Create site' ) ],
			run: () => openAddSite(),
		},
		{
			id: 'settings',
			group: 'quick',
			label: __( 'Settings' ),
			icon: settingsIcon,
			priority: 2,
			aliases: [ __( 'Open settings' ), __( 'Preferences' ) ],
			run: () => openSettings(),
		},
		...chats.slice( 0, RECENT_CHATS_LIMIT ).map(
			( chat ): PaletteCommand => ( {
				id: `recent-${ chat.session.id }`,
				group: 'recent',
				browseOnly: true,
				...chatCommand( chat ),
			} )
		),
		{
			id: 'color-scheme',
			group: 'settings',
			label: colorScheme === 'dark' ? __( 'Use light mode' ) : __( 'Use dark mode' ),
			icon: settingsIcon,
			keywords: [ __( 'Appearance' ), __( 'Theme' ), __( 'Dark mode' ), __( 'Light mode' ) ],
			run: () =>
				savePreferences.mutate( { colorScheme: colorScheme === 'dark' ? 'light' : 'dark' } ),
		},
		{
			id: 'reset-appearance-tint',
			group: 'settings',
			label: __( 'Reset appearance tint' ),
			icon: settingsIcon,
			keywords: [ __( 'Appearance' ), __( 'Color' ), __( 'Intensity' ), __( 'Contrast' ) ],
			run: () => savePreferences.mutate( DEFAULT_COLOR_TINT ),
		},
		...settingCommands,
		{
			id: 'sidebar',
			group: 'commands',
			label: sidebarOpen ? __( 'Hide sidebar' ) : __( 'Show sidebar' ),
			icon: sidebarExpandedIcon,
			keywords: [ __( 'Toggle sidebar' ) ],
			run: toggleSidebar,
		},
		{
			id: 'notifications',
			group: 'commands',
			label: __( 'Show notifications' ),
			icon: bellIcon,
			aliases: [ __( 'Notifications' ) ],
			run: openNoticeHistory,
		},
		...( collapseAll
			? [
					{
						id: 'collapse-all',
						group: 'commands' as const,
						label: __( 'Collapse all' ),
						icon: collapseAllIcon,
						aliases: [ __( 'Collapse all sites' ) ],
						run: collapseAll,
					},
			  ]
			: [] ),
		...( sites ?? [] ).map(
			( site ): PaletteCommand => ( {
				id: `site-${ site.id }`,
				group: 'sites',
				label: site.name,
				icon: globeIcon,
				run: () => openSite( site, chats.find( ( chat ) => chat.site?.id === site.id )?.session ),
			} )
		),
		...chats.map(
			( chat ): PaletteCommand => ( {
				id: `chat-${ chat.session.id }`,
				group: 'chats',
				searchOnly: true,
				...chatCommand( chat ),
			} )
		),
	];
}

// The boolean preferences setting commands turn on or off in place, by the id
// of their row in Settings.
function useSettingToggles(): Record< string, { checked: boolean; run: () => void } > {
	const { data: preferences } = useUserPreferences();
	const { showRecentChats, autoCollapseSites } = useSidebarPreferences();
	const save = useSaveUserPreferences();
	const toggle = ( key: keyof UserPreferences, checked: boolean | undefined ) => ( {
		checked: !! checked,
		run: () =>
			save.mutate( {
				[ key ]: ! checked,
				...( key === 'analyticsEnabled' && { source: { surface: 'settings' as const } } ),
			} ),
	} );
	if ( ! preferences ) {
		return {};
	}
	return {
		'show-recent-chats': toggle( 'showRecentChats', showRecentChats ),
		'collapse-sidebar-groups': toggle( 'autoCollapseSites', autoCollapseSites ),
		'auto-start-site': toggle( 'autoStartSiteOnChat', preferences.autoStartSiteOnChat ),
		'confirm-delete-annotations': toggle(
			'confirmDeleteAnnotations',
			preferences.confirmDeleteAnnotations
		),
		'usage-statistics': toggle( 'analyticsEnabled', preferences.analyticsEnabled ),
		'studio-code': toggle( 'agenticFeaturesEnabled', preferences.agenticFeaturesEnabled ?? true ),
	};
}

// Every settings section, and every setting in it, shown while searching. A
// switch is turned on or off in place; any other setting opens with its
// control focused.
function useSettingCommands( scope: 'studio' | 'site', site?: SiteDetails ): PaletteCommand[] {
	const openSettings = useOpenSettings();
	const toggles = useSettingToggles();
	const user = useAuthUser();
	const signedIn = ! user.isSuccess || !! user.data;
	const group = scope === 'site' ? 'site-settings' : 'settings';
	return getSections( scope, { signedIn } ).flatMap( ( section ) => [
		{
			id: `${ group }-${ section.id }`,
			group,
			label: section.label,
			icon: section.icon,
			description: site?.name,
			keywords: [ getGroupLabel( group ) ],
			searchOnly: true,
			run: () => openSettings( section.id, site?.id ),
		},
		...section.settings.map( ( { id, title, description } ): PaletteCommand => {
			const toggle = scope === 'studio' && id ? toggles[ id ] : undefined;
			return {
				id: `${ group }-${ section.id }-${ id ?? title }`,
				group,
				label: toggle
					? sprintf(
							/* translators: %s: the name of a setting, e.g. "Show recent chats". */
							toggle.checked ? __( 'Turn off “%s”' ) : __( 'Turn on “%s”' ),
							title
					  )
					: title,
				aliases: [ title ],
				icon: section.icon,
				description: site?.name ?? section.label,
				keywords: [ section.label, description ],
				searchOnly: true,
				run: toggle?.run ?? ( () => openSettings( section.id, site?.id, id ?? title ) ),
			};
		} ),
	] );
}

function SiteCommands( {
	site,
	session,
	chatHidden,
	commands,
	...palette
}: PaletteProps & { site: SiteDetails; session?: AiSessionSummary; chatHidden?: boolean } ) {
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const connector = useConnector();
	const { chatEnabled } = useAgenticFeatures();
	const actions = useSiteActions( site );
	const { busy, running, othersRunning } = actions;
	const destinations = useOpenInDestinations( site );
	const manage = useSiteManagementActions( site, {
		onDelete: actions.openDelete,
		onImport: actions.openImport,
	} );
	const preview = useSessionPreviewUI();
	const dispatch = useSessionUIDispatch();
	const openHeaderPanel = useOpenHeaderPanel();
	const annotations = useSiteAnnotations( site.id );
	const settingCommands = useSettingCommands( 'site', site );
	const description = site.name;
	const previewShown = preview.open && preview.siteId === site.id;
	const keywords: Record< string, string[] > = {
		files: [ __( 'Folder' ), __( 'Directory' ), __( 'Finder' ) ],
		editor: [ __( 'Code editor' ), __( 'IDE' ) ],
		terminal: [ __( 'Shell' ), __( 'Command line' ) ],
		phpmyadmin: [ __( 'Database' ), 'SQL', 'MySQL' ],
		'wp-admin': [ __( 'Dashboard' ), 'wp-admin' ],
	};

	const siteCommands: PaletteCommand[] = [
		...( chatEnabled
			? [
					{
						id: 'new-chat',
						group: 'quick' as const,
						label: __( 'New chat' ),
						icon: newChatIcon,
						priority: 1,
						description,
						aliases: [ __( 'Add chat' ), __( 'Create chat' ) ],
						run: () => void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } ),
					},
			  ]
			: [] ),
		...( busy
			? []
			: [
					{
						id: 'lifecycle',
						group: 'quick' as const,
						label: site.running ? __( 'Stop site' ) : __( 'Start site' ),
						icon: site.running ? stopSiteIcon : startSiteIcon,
						description,
						run: actions.toggleRunning,
					},
			  ] ),
		{
			id: 'site-settings',
			group: 'quick',
			label: __( 'Site settings' ),
			icon: settingsIcon,
			priority: 2,
			description,
			run: () => openSettings( 'site', site.id ),
		},
		{
			id: 'rename-site',
			group: 'site',
			label: __( 'Rename site…' ),
			icon: renameIcon,
			description,
			run: actions.rename,
		},
		...( busy
			? []
			: [
					{
						id: 'admin',
						group: 'site' as const,
						label: __( 'Open WordPress Admin' ),
						icon: wordpress,
						description,
						keywords: keywords[ 'wp-admin' ],
						run: actions.openAdmin,
					},
					{
						id: 'database',
						group: 'site' as const,
						label: __( 'Open database' ),
						icon: databaseIcon,
						description,
						keywords: keywords.phpmyadmin,
						run: actions.openDatabase,
					},
					...( site.running
						? [
								{
									id: 'restart',
									group: 'site' as const,
									label: __( 'Restart site' ),
									icon: refreshIcon,
									description,
									run: () => void actions.restart(),
								},
						  ]
						: [] ),
					...( site.running && othersRunning.length
						? [
								{
									id: 'stop-others',
									group: 'site' as const,
									label: __( 'Stop other sites' ),
									icon: stopSiteIcon,
									run: () => actions.stop( othersRunning ),
								},
						  ]
						: [] ),
			  ] ),
		...( running.length > 1
			? [
					{
						id: 'stop-all',
						group: 'site' as const,
						label: __( 'Stop all sites' ),
						icon: stopSiteIcon,
						run: () => actions.stop( running ),
					},
			  ]
			: [] ),
		...destinations
			.filter( ( destination ) => ! destination.disabled )
			.map(
				( destination ): PaletteCommand => ( {
					id: `open-${ destination.id }`,
					group: 'site',
					label: sprintf(
						/* translators: %s is the name of the app. E.g. "Open in Cursor" */
						__( 'Open in %s' ),
						destination.label
					),
					icon: destination.logo,
					description,
					keywords: keywords[ destination.id ],
					run: destination.open,
				} )
			),
		...( previewShown && site.running
			? [
					{
						id: 'reload',
						group: 'site' as const,
						label: __( 'Reload preview' ),
						icon: refreshIcon,
						keywords: [ __( 'Refresh' ) ],
						run: () => dispatch( { type: 'preview/reload' } ),
					},
			  ]
			: [] ),
		...( previewShown &&
		site.running &&
		chatEnabled &&
		( connector.capabilities.annotatePreview || annotations.active )
			? [
					{
						id: 'annotate',
						group: 'site' as const,
						label: annotations.active ? __( 'Exit annotations' ) : __( 'Annotate' ),
						icon: annotateIcon,
						description,
						run: () => setAnnotating( site.id, ! annotations.active ),
					},
			  ]
			: [] ),
		{
			id: 'preview-visibility',
			group: 'site',
			label: previewShown ? __( 'Hide preview' ) : __( 'Show preview' ),
			icon: previewShown ? unseen : seen,
			description,
			run: () => {
				preview.setSite( site.id );
				preview.setOpen( ! previewShown );
			},
		},
		...( chatHidden === undefined
			? []
			: [
					{
						id: 'chat-visibility',
						group: 'site' as const,
						label: chatHidden ? __( 'Show chat' ) : __( 'Hide chat' ),
						icon: chatIcon,
						run: () => preview.setChatHidden( ! chatHidden ),
					},
			  ] ),
		{
			id: 'share',
			group: 'site',
			label: __( 'Share site…' ),
			icon: shareIcon,
			description,
			keywords: [ __( 'preview link' ) ],
			run: () => openHeaderPanel( { panel: 'share', siteId: site.id } ),
		},
		{
			id: 'publish',
			group: 'site',
			label: __( 'Publish & Sync…' ),
			icon: cloudUpload,
			description,
			keywords: [ __( 'publish site sync push pull upload download' ) ],
			run: () => openHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ),
		},
		{
			id: 'copy-url',
			group: 'site',
			label: __( 'Copy site URL' ),
			icon: copy,
			description,
			keywords: [ __( 'Address' ), __( 'Link' ) ],
			run: () =>
				void connector
					.copyText( getSiteUrl( site ) )
					.then( () => toast.success( __( 'Site URL copied' ) ) ),
		},
		{
			id: 'pin-site',
			group: 'site',
			label: actions.pinned ? __( 'Unpin site' ) : __( 'Pin site' ),
			icon: actions.pinned ? unpinIcon : pinIcon,
			description,
			run: actions.togglePin,
		},
		...manage
			.filter( ( action ) => action.id !== 'delete' && ! action.disabled )
			.map(
				( action ): PaletteCommand => ( {
					id: action.id,
					group: 'site',
					label:
						action.id === 'duplicate'
							? __( 'Duplicate site' )
							: action.id === 'import'
							? __( 'Import backup…' )
							: action.label,
					icon: action.icon,
					description,
					keywords: [ __( 'Backup' ) ],
					run: action.run,
				} )
			),
		...settingCommands,
	];

	const props = { ...palette, commands: [ ...commands, ...siteCommands ] };
	return (
		<>
			{ session && ! session.archived && chatEnabled ? (
				<ChatCommands key={ session.id } session={ session } { ...props } />
			) : (
				<PaletteDialog { ...props } />
			) }
			{ actions.dialogs }
		</>
	);
}

function ChatCommands( {
	session,
	commands,
	...palette
}: PaletteProps & { session: AiSessionSummary } ) {
	const actions = useChatActions( session, true );
	const description = getSessionTitle( session );
	const chatCommands: PaletteCommand[] = [
		{
			id: 'pin-chat',
			group: 'chat',
			label: actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ),
			icon: actions.pinned ? unpinIcon : pinIcon,
			description,
			run: actions.togglePin,
		},
		{
			id: 'rename-chat',
			group: 'chat',
			label: __( 'Rename chat…' ),
			icon: renameIcon,
			description,
			run: actions.rename,
		},
		...( actions.working
			? []
			: [
					{
						id: 'archive-chat',
						group: 'chat' as const,
						label: __( 'Archive chat' ),
						icon: archiveIcon,
						description,
						run: () => void actions.archive(),
					},
			  ] ),
	];
	return (
		<>
			<PaletteDialog { ...palette } commands={ [ ...commands, ...chatCommands ] } />
			{ actions.renameDialog }
		</>
	);
}

function PaletteDialog( { open, onOpenChange, commands }: PaletteProps ) {
	const [ query, setQuery ] = useState( '' );
	const matches = matchCommands( commands, query );
	const groups: { value: string; items: PaletteCommand[] }[] = [];
	for ( const command of matches ) {
		const value = getGroupLabel( command.group );
		const last = groups.at( -1 );
		if ( last?.value === value ) {
			last.items.push( command );
		} else {
			groups.push( { value, items: [ command ] } );
		}
	}

	return (
		<Dialog
			open={ open }
			onOpenChange={ onOpenChange }
			onOpenChangeComplete={ ( isOpen ) => ! isOpen && setQuery( '' ) }
		>
			<DialogContent
				surface="composer"
				backdrop="transparent"
				className={ styles.popup }
				aria-label={ __( 'Command palette' ) }
			>
				<Autocomplete.Root
					open
					inline
					mode="none"
					items={ groups }
					value={ query }
					onValueChange={ setQuery }
					itemToStringValue={ ( command: PaletteCommand ) => command.label }
					autoHighlight="always"
					keepHighlight
				>
					<InputGroup className={ styles.inputGroup }>
						<Autocomplete.Input
							render={ <InputGroupInput /> }
							placeholder={ __( 'Search commands' ) }
							aria-label={ __( 'Search commands' ) }
						/>
						<InputGroupAddon>
							<Icon icon={ search } className={ styles.icon } />
						</InputGroupAddon>
					</InputGroup>
					<Autocomplete.Empty className={ styles.empty }>
						{ __( 'No commands found.' ) }
					</Autocomplete.Empty>
					<Autocomplete.List className={ styles.list }>
						{ ( group: ( typeof groups )[ number ] ) => (
							<Autocomplete.Group key={ group.value } items={ group.items }>
								<Autocomplete.GroupLabel className={ styles.groupLabel }>
									{ group.value }
								</Autocomplete.GroupLabel>
								<Autocomplete.Collection>
									{ ( command: PaletteCommand ) => (
										<Autocomplete.Item
											key={ command.id }
											value={ command }
											className={ styles.item }
											onClick={ () => {
												onOpenChange( false );
												command.run();
											} }
										>
											<Icon icon={ command.icon } size={ 16 } className={ styles.icon } />
											<span className={ styles.label }>{ command.label }</span>
											{ command.description ? (
												<span className={ styles.description }>{ command.description }</span>
											) : null }
										</Autocomplete.Item>
									) }
								</Autocomplete.Collection>
							</Autocomplete.Group>
						) }
					</Autocomplete.List>
				</Autocomplete.Root>
			</DialogContent>
		</Dialog>
	);
}
