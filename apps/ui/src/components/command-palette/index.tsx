import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { copy, Icon, search } from '@wordpress/icons';
import { isKeyboardEvent } from '@wordpress/keycodes';
import { useEffect, useState } from 'react';
import { useChatActions } from '@/components/chat-actions';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useIsSiteBusy, useSites, useStartSite, useStopSite } from '@/data/queries/use-sites';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpenSite } from '@/hooks/use-open-site';
import { useSessionUIDispatch, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarOpen, useToggleSidebar } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { getSiteUrl } from '@/lib/get-site-url';
import {
	archiveIcon,
	chatIcon,
	globeIcon,
	newChatIcon,
	pinIcon,
	plusIcon,
	refreshIcon,
	renameIcon,
	settingsIcon,
	sidebarExpandedIcon,
	startSiteIcon,
	stopSiteIcon,
	unpinIcon,
} from '@/lib/icons';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

const GROUPS = [ 'quick', 'recent', 'site', 'chat', 'settings', 'sites', 'chats' ] as const;
type GroupId = ( typeof GROUPS )[ number ];

type PaletteCommand = {
	id: string;
	group: GroupId;
	label: string;
	icon: ReactElement;
	description?: string;
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
		settings: __( 'Settings' ),
		sites: __( 'Sites' ),
		chats: __( 'Chats' ),
	}[ group ];
}

const byPriority = ( a: PaletteCommand, b: PaletteCommand ) =>
	( a.priority ?? 0 ) - ( b.priority ?? 0 );

const normalize = ( value: string ) => value.trim().toLocaleLowerCase().replace( /\s+/g, ' ' );

// Commands whose label contains every typed word rank above those matching
// only through keywords; groups are ordered by their best match.
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
			const label = normalize( command.label );
			const terms = [ label, ...( command.keywords ?? [] ).map( normalize ) ];
			const score =
				label === words.join( ' ' )
					? 3
					: words.every( ( word ) => label.includes( word ) )
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
	const [ open, setOpen ] = useState( false );
	const commands = useAppCommands();

	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.defaultPrevented || event.repeat || ! isKeyboardEvent.primary( event, 'k' ) ) {
				return;
			}
			if ( ! open && document.querySelector( '[role="dialog"], [role="alertdialog"]' ) ) {
				return;
			}
			event.preventDefault();
			setOpen( ! open );
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ open ] );

	const palette = { open, onOpenChange: setOpen, commands };
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
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const { chatEnabled } = useAgenticFeatures();
	const openSite = useOpenSite();
	const sidebarOpen = useSidebarOpen();
	const toggleSidebar = useToggleSidebar();
	const colorScheme = useColorScheme();
	const savePreferences = useSaveUserPreferences();

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
			keywords: [ __( 'Add site' ), __( 'Create site' ) ],
			run: () => void navigate( { to: '/onboarding' } ),
		},
		{
			id: 'settings',
			group: 'quick',
			label: __( 'Settings' ),
			icon: settingsIcon,
			priority: 2,
			keywords: [ __( 'Preferences' ) ],
			run: () => void navigate( { to: '/settings' } ),
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
			id: 'sidebar',
			group: 'settings',
			label: sidebarOpen ? __( 'Hide sidebar' ) : __( 'Show sidebar' ),
			icon: sidebarExpandedIcon,
			run: toggleSidebar,
		},
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

function SiteCommands( {
	site,
	session,
	chatHidden,
	commands,
	...palette
}: PaletteProps & { site: SiteDetails; session?: AiSessionSummary; chatHidden?: boolean } ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const { chatEnabled } = useAgenticFeatures();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const { isPinned, togglePin } = useSidebarPins();
	const pinned = isPinned( sitePinKey( site.id ) );
	const destinations = useOpenInDestinations( site );
	const manage = useSiteManagementActions( site, { onDelete: () => {} } );
	const preview = useSessionPreviewUI();
	const dispatch = useSessionUIDispatch();
	const description = site.name;

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
						run: () => ( site.running ? stopSite : startSite ).mutate( site.id ),
					},
			  ] ),
		{
			id: 'site-settings',
			group: 'quick',
			label: __( 'Site settings' ),
			icon: settingsIcon,
			priority: 2,
			description,
			run: () => void navigate( { to: '/sites/$siteId/settings', params: { siteId: site.id } } ),
		},
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
					run: destination.open,
				} )
			),
		...( preview.open && site.running
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
			label: pinned ? __( 'Unpin site' ) : __( 'Pin site' ),
			icon: pinned ? unpinIcon : pinIcon,
			description,
			run: () => togglePin( sitePinKey( site.id ) ),
		},
		...manage
			.filter( ( action ) => action.id !== 'delete' && ! action.disabled )
			.map(
				( action ): PaletteCommand => ( {
					id: action.id,
					group: 'site',
					label: action.id === 'duplicate' ? __( 'Duplicate site' ) : action.label,
					icon: action.icon,
					description,
					keywords: [ __( 'Backup' ) ],
					run: action.run,
				} )
			),
	];

	const props = { ...palette, commands: [ ...commands, ...siteCommands ] };
	return session && ! session.archived && chatEnabled ? (
		<ChatCommands key={ session.id } session={ session } { ...props } />
	) : (
		<PaletteDialog { ...props } />
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
		<Dialog.Root
			open={ open }
			onOpenChange={ onOpenChange }
			onOpenChangeComplete={ ( isOpen ) => ! isOpen && setQuery( '' ) }
		>
			<Dialog.Portal>
				<Dialog.Backdrop className={ styles.overlay } />
				<Dialog.Popup className={ styles.popup } aria-label={ __( 'Command palette' ) }>
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
						<div className={ styles.inputGroup }>
							<Icon icon={ search } size={ 16 } className={ styles.searchIcon } />
							<Autocomplete.Input
								className={ styles.input }
								placeholder={ __( 'Search commands' ) }
								aria-label={ __( 'Search commands' ) }
							/>
						</div>
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
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
