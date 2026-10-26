import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { __, sprintf } from '@wordpress/i18n';
import {
	PanelLeftIcon,
	PencilIcon,
	PlusIcon,
	RefreshCwIcon,
	SettingsIcon,
	SparklesIcon,
} from 'lucide-react';
import { getSections } from '@/data/settings-sections';
import { getSessionTitle } from '@/features/chats';
import {
	AppearanceIcon,
	ArchiveIcon,
	BellIcon,
	ChatIcon,
	CollapseAllIcon,
	GlobeIcon,
	PinIcon,
	UnpinIcon,
} from '@/lib/icons';
import { DEFAULT_COLOR_TINT } from '@/lib/theme';
import type { AiSessionSummary, SiteDetails, WritableUserPreferences } from '@/data/core';
import type { useOpenSettings } from '@/data/use-open-settings';
import type { useChatActions } from '@/features/chats';
import type { ComponentType } from 'react';

export const GROUPS = [
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

export type SettingToggles = Record< string, { checked: boolean; run: () => void } >;

type OpenSettings = ReturnType< typeof useOpenSettings >;

const RECENT_CHATS_LIMIT = 5;

export function getGroupLabel( group: GroupId ) {
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
			aliases: [ __( 'Open settings' ), __( 'Preferences' ) ],
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
			group: 'settings',
			label: colorScheme === 'dark' ? __( 'Use light mode' ) : __( 'Use dark mode' ),
			icon: AppearanceIcon,
			aliases: [ __( 'Toggle theme' ) ],
			keywords: [ __( 'Appearance' ), __( 'Theme' ), __( 'Dark mode' ), __( 'Light mode' ) ],
			run: () => savePreferences( { colorScheme: colorScheme === 'dark' ? 'light' : 'dark' } ),
		},
		{
			id: 'reset-appearance-tint',
			group: 'settings',
			label: __( 'Reset appearance tint' ),
			icon: RefreshCwIcon,
			keywords: [
				__( 'Appearance' ),
				__( 'Color' ),
				__( 'Colour' ),
				__( 'Intensity' ),
				__( 'Contrast' ),
			],
			run: () => savePreferences( DEFAULT_COLOR_TINT ),
		},
		...settingCommands,
		{
			id: 'sidebar',
			group: 'commands',
			label: sidebarOpen ? __( 'Hide sidebar' ) : __( 'Show sidebar' ),
			icon: PanelLeftIcon,
			keywords: [ __( 'Toggle sidebar' ) ],
			run: toggleSidebar,
		},
		{
			id: 'notifications',
			group: 'commands',
			label: __( 'Show notifications' ),
			icon: BellIcon,
			aliases: [ __( 'Notifications' ) ],
			// The history opens from the bell in the sidebar.
			run: () => {
				if ( ! sidebarOpen ) {
					toggleSidebar();
				}
				openNotifications();
			},
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
				run: () => openSite( site, chats.find( ( chat ) => chat.site.id === site.id )?.session ),
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

// Every settings section, and every setting in it, shown while searching. A
// switch is turned on or off in place; any other setting opens with its
// control focused.
export function getSettingCommands( {
	scope,
	site,
	signedIn,
	toggles,
	openSettings,
}: {
	scope: 'studio' | 'site';
	site?: SiteDetails;
	signedIn: boolean;
	// The boolean preferences setting commands turn on or off in place, by the
	// id of their row in Settings.
	toggles: SettingToggles;
	openSettings: OpenSettings;
} ): PaletteCommand[] {
	const group = scope === 'site' ? 'site-settings' : 'settings';
	return getSections( scope, { signedIn } ).flatMap( ( section ) => [
		{
			id: `${ group }-${ section.id }`,
			group,
			label: section.label,
			aliases: section.aliases,
			icon: section.icon,
			description: site?.name,
			keywords: [ getGroupLabel( group ) ],
			searchOnly: true,
			run: () => openSettings( section.id, site?.id ),
		},
		...section.settings.map( ( { id, title, description, icon, aliases } ): PaletteCommand => {
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
				aliases: [ title, ...( aliases ?? [] ) ],
				icon: icon ?? section.icon,
				description: site?.name ?? section.label,
				keywords: [ section.label, description ],
				searchOnly: true,
				run: toggle?.run ?? ( () => openSettings( section.id, site?.id, id ?? title ) ),
			};
		} ),
	] );
}

export function getChatCommands(
	session: AiSessionSummary,
	actions: ReturnType< typeof useChatActions >
): PaletteCommand[] {
	const description = getSessionTitle( session );
	return [
		{
			id: 'pin-chat',
			group: 'chat',
			label: actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ),
			icon: actions.pinned ? UnpinIcon : PinIcon,
			description,
			run: actions.togglePin,
		},
		{
			id: 'rename-chat',
			group: 'chat',
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
						group: 'chat' as const,
						label: __( 'Archive chat' ),
						icon: ArchiveIcon,
						description,
						run: () => void actions.archive(),
					},
			  ] ),
	];
}
