import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import { __, sprintf } from '@wordpress/i18n';
import { PencilIcon, SettingsIcon, SparklesIcon } from 'lucide-react';
import { getSections, getSettingsCommandAliases } from '@/data/settings-sections';
import { getSessionTitle } from '@/features/chats';
import {
	PlusIcon,
	AppearanceIcon,
	ArchiveIcon,
	BellIcon,
	ChatIcon,
	CollapseAllIcon,
	GlobeIcon,
	PinIcon,
	SidebarIcon,
	UnpinIcon,
} from '@/lib/icons';
import type { AiSessionSummary, SiteDetails, WritableUserPreferences } from '@/data/core';
import type { useOpenSettings } from '@/data/use-open-settings';
import type { useChatActions } from '@/features/chats';
import type { ComponentType } from 'react';

export const GROUPS = [
	'quick',
	'recent',
	'commands',
	'site-settings',
	'settings',
	'sites',
	'chats',
] as const;
export type GroupId = ( typeof GROUPS )[ number ];

export type PaletteCommand = {
	id: string;
	group: GroupId;
	label: string;
	icon: ComponentType< { className?: string } >;
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

export type PaletteChat = { session: AiSessionSummary; site: SiteDetails };

export type SettingToggles = Record<
	string,
	{ checked: boolean; label?: string; run: () => void }
>;
export type SettingActions = Record<
	string,
	{ label?: string; aliases?: string[]; run: () => void }
>;

type OpenSettings = ReturnType< typeof useOpenSettings >;

const RECENT_CHATS_LIMIT = 5;

export function getGroupLabel( group: GroupId ) {
	return {
		quick: __( 'Quick actions' ),
		recent: __( 'Recent chats' ),
		'site-settings': __( 'Site settings' ),
		settings: __( 'App settings' ),
		commands: __( 'Commands' ),
		sites: __( 'Sites' ),
		chats: __( 'Chats' ),
	}[ group ];
}

// Unarchived chats of a known site, most recently updated first.
export function getPaletteChats(
	sessions: AiSessionSummary[],
	sites: SiteDetails[]
): PaletteChat[] {
	return sessions
		.filter( ( session ) => ! session.archived )
		.map( ( session ) => ( { session, site: findAiSessionOwnerSite( sites, session ) } ) )
		.filter( ( chat ): chat is PaletteChat => !! chat.site )
		.sort(
			( a, b ) =>
				( Date.parse( b.session.updatedAt ) || 0 ) - ( Date.parse( a.session.updatedAt ) || 0 )
		);
}

export function getAppCommands( {
	sites,
	chats,
	colorScheme,
	sidebarOpen,
	settingCommands,
	openAddSite,
	openSettings,
	openSite,
	openChat,
	savePreferences,
	toggleSidebar,
	openNotifications,
	openWhatsNew,
	collapseAll,
}: {
	sites: SiteDetails[];
	chats: PaletteChat[];
	colorScheme: 'light' | 'dark';
	sidebarOpen: boolean;
	settingCommands: PaletteCommand[];
	openAddSite: () => void;
	openSettings: () => void;
	openSite: ( site: SiteDetails, session?: AiSessionSummary ) => void;
	openChat: ( session: AiSessionSummary ) => void;
	savePreferences: ( preferences: Partial< WritableUserPreferences > ) => void;
	toggleSidebar: () => void;
	openNotifications: () => void;
	openWhatsNew: () => void;
	// Set while the sidebar has more than one site unfolded.
	collapseAll?: () => void;
} ): PaletteCommand[] {
	const chatCommand = ( { session, site }: PaletteChat ) => ( {
		label: getSessionTitle( session ),
		icon: ChatIcon,
		description: site.name,
		run: () => openChat( session ),
	} );

	return [
		{
			id: 'new-site',
			group: 'quick',
			label: __( 'New site' ),
			icon: PlusIcon,
			aliases: [ __( 'Add site' ), __( 'Create site' ) ],
			run: openAddSite,
		},
		{
			id: 'settings',
			group: 'quick',
			label: __( 'Settings' ),
			icon: SettingsIcon,
			priority: 2,
			aliases: [
				__( 'App settings' ),
				__( 'Open settings' ),
				__( 'Preferences' ),
				...getSettingsCommandAliases( 'studio', 'settings' ),
			],
			run: openSettings,
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
			group: 'commands',
			label: colorScheme === 'dark' ? __( 'Use light mode' ) : __( 'Use dark mode' ),
			icon: AppearanceIcon,
			aliases: [ __( 'Toggle theme' ) ],
			keywords: [ __( 'Appearance' ), __( 'Theme' ), __( 'Dark mode' ), __( 'Light mode' ) ],
			run: () => savePreferences( { colorScheme: colorScheme === 'dark' ? 'light' : 'dark' } ),
		},
		...settingCommands,
		{
			id: 'sidebar',
			group: 'commands',
			label: sidebarOpen ? __( 'Hide sidebar' ) : __( 'Show sidebar' ),
			icon: SidebarIcon,
			keywords: [ __( 'Toggle sidebar' ) ],
			run: toggleSidebar,
		},
		{
			id: 'notifications',
			group: 'commands',
			label: __( 'Show notifications' ),
			icon: BellIcon,
			aliases: [ __( 'Notifications' ) ],
			run: openNotifications,
		},
		{
			id: 'whats-new',
			group: 'commands',
			label: __( 'What’s New' ),
			icon: SparklesIcon,
			keywords: [ __( 'New features' ) ],
			run: openWhatsNew,
		},
		...( collapseAll
			? [
					{
						id: 'collapse-all',
						group: 'commands' as const,
						label: __( 'Collapse all' ),
						icon: CollapseAllIcon,
						aliases: [ __( 'Collapse all sites' ) ],
						run: collapseAll,
					},
			  ]
			: [] ),
		...sites.map(
			( site ): PaletteCommand => ( {
				id: `site-${ site.id }`,
				group: 'sites',
				label: site.name,
				icon: GlobeIcon,
				run: () => openSite( site ),
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

// The settings registry chooses palette destinations and actions independently of Settings search.
export function getSettingCommands( {
	scope,
	site,
	signedIn,
	toggles,
	actions = {},
	openSettings,
}: {
	scope: 'studio' | 'site';
	site?: SiteDetails;
	signedIn: boolean;
	// The boolean preferences setting commands turn on or off in place, by the
	// id of their row in Settings.
	toggles: SettingToggles;
	actions?: SettingActions;
	openSettings: OpenSettings;
} ): PaletteCommand[] {
	const prefix = scope === 'site' ? 'site-settings' : 'settings';
	const group = prefix;
	if ( scope === 'site' && ! site ) return [];
	return getSections( scope, { signedIn } ).flatMap( ( section ) => {
		const folded = section.settings.filter( ( entry ) => entry.palette === 'section' );
		const navigation: PaletteCommand[] =
			typeof section.palette === 'string'
				? [
						{
							id: `${ prefix }-${ section.id }`,
							group,
							label: section.palette,
							aliases: [
								section.label,
								sprintf(
									/* translators: %s: the name of a settings section. */
									__( 'Open %s settings' ),
									section.label
								),
								...( section.aliases ?? [] ),
								...folded.flatMap( ( entry ) => [ entry.title, ...( entry.aliases ?? [] ) ] ),
							],
							icon: section.icon,
							description: site?.name,
							keywords: [
								getGroupLabel( group ),
								...( scope === 'studio' ? [ 'WordPress Studio' ] : [] ),
								...folded.map( ( entry ) => entry.description ),
							],
							run: () => {
								const focus = folded.find( ( entry ) => entry.id )?.id;
								if ( focus ) openSettings( section.id, site?.id, focus );
								else openSettings( section.id, site?.id );
							},
						},
				  ]
				: [];
		return [
			...navigation,
			...section.settings.flatMap(
				( { id, title, description, icon, aliases, palette } ): PaletteCommand[] => {
					if ( palette !== 'navigate' && palette !== 'action' ) return [];
					const toggle =
						palette === 'action' && scope === 'studio' && id ? toggles[ id ] : undefined;
					const action =
						palette === 'action' && scope === 'studio' && id ? actions[ id ] : undefined;
					if ( palette === 'action' && ! toggle && ! action ) return [];
					return [
						{
							id: `${ prefix }-${ section.id }-${ id }`,
							group: palette === 'action' ? 'commands' : group,
							label: toggle
								? toggle.label ??
								  sprintf(
										/* translators: %s: the name of a setting. */
										toggle.checked ? __( 'Turn off “%s”' ) : __( 'Turn on “%s”' ),
										title
								  )
								: action?.label ?? title,
							aliases: [
								title,
								...( palette === 'navigate'
									? [
											sprintf(
												/* translators: %s: the name of a setting. */
												__( 'Open %s settings' ),
												title
											),
									  ]
									: [] ),
								...( aliases ?? [] ),
								...( action?.aliases ?? [] ),
							],
							icon: icon ?? section.icon,
							description: site?.name ?? section.label,
							keywords: [ section.label, description ],
							run: toggle?.run ?? action?.run ?? ( () => openSettings( section.id, site?.id, id ) ),
						},
					];
				}
			),
		];
	} );
}

export function getChatCommands(
	session: AiSessionSummary,
	actions: ReturnType< typeof useChatActions >
): PaletteCommand[] {
	const description = getSessionTitle( session );
	return [
		{
			id: 'pin-chat',
			group: 'commands',
			label: actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ),
			icon: actions.pinned ? UnpinIcon : PinIcon,
			description,
			run: actions.togglePin,
		},
		{
			id: 'rename-chat',
			group: 'commands',
			label: __( 'Rename chat…' ),
			icon: PencilIcon,
			description,
			run: actions.rename,
		},
		...( actions.working
			? []
			: [
					{
						id: 'archive-chat',
						group: 'commands' as const,
						label: __( 'Archive chat' ),
						icon: ArchiveIcon,
						description,
						run: () => void actions.archive(),
					},
			  ] ),
	];
}
