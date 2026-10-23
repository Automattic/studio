import { __ } from '@wordpress/i18n';
import {
	BugIcon,
	ChartNoAxesColumnIncreasingIcon,
	CodeIcon,
	FileTextIcon,
	SettingsIcon,
	TerminalIcon,
} from 'lucide-react';
import { AppearanceIcon } from '@/lib/icons/appearance-icon';
import { IntelligenceIcon } from '@/lib/icons/intelligence-icon';
import { KeyboardIcon } from '@/lib/icons/keyboard-icon';
import { LanguageIcon } from '@/lib/icons/language-icon';
import { McpIcon } from '@/lib/icons/mcp-icon';
import { PhpIcon } from '@/lib/icons/php-icon';
import { ShareIcon } from '@/lib/icons/share-icon';
import { SiteSettingsIcon } from '@/lib/icons/site-settings-icon';
import { SkillsIcon } from '@/lib/icons/skills-icon';
import type { ComponentType } from 'react';

const STUDIO_SECTIONS = [
	'general',
	'appearance',
	'sharing',
	'ai',
	'mcp',
	'usage',
	'skills',
	'instructions',
	'keyboard',
] as const;
export const SITE_SECTIONS = [
	'site',
	'debugging',
	'php',
	'site-skills',
	'site-instructions',
] as const;

export type SettingsSectionId =
	| ( typeof STUDIO_SECTIONS )[ number ]
	| ( typeof SITE_SECTIONS )[ number ];
export type SettingsScope = 'studio' | 'site';

export function isSettingsSection( value: unknown ): value is SettingsSectionId {
	return ( [ ...STUDIO_SECTIONS, ...SITE_SECTIONS ] as unknown[] ).includes( value );
}

export function isSiteSection( value: SettingsSectionId ) {
	return ( SITE_SECTIONS as readonly string[] ).includes( value );
}

// A setting search can find. `id` is the stable name a settings link uses.
export type Setting = { id?: string; title: string; description: string; icon?: SectionIcon };

type SectionIcon = ComponentType< { className?: string } >;

export type Section = {
	id: SettingsSectionId;
	label: string;
	icon: SectionIcon;
	settings: Setting[];
};

const setting = ( title: string, description = '', id?: string, icon?: SectionIcon ): Setting => ( {
	id,
	title,
	description,
	icon,
} );

function getStudioSections( signedIn: boolean ): Section[] {
	const sections: Section[] = [
		{
			id: 'general',
			label: __( 'General' ),
			icon: SettingsIcon,
			settings: [
				setting( __( 'Language' ), __( 'Default language for Studio.' ), 'language', LanguageIcon ),
				setting(
					__( 'Code editor' ),
					__( 'The default code editor for your sites.' ),
					'code-editor',
					CodeIcon
				),
				setting(
					__( 'Terminal' ),
					__( 'The default terminal for your sites.' ),
					'terminal',
					TerminalIcon
				),
				setting(
					__( 'Default directory' ),
					__( 'The folder where Studio creates new sites.' ),
					'default-directory'
				),
				setting(
					__( 'Improve Studio for everyone' ),
					__( 'Share anonymous usage statistics to improve Studio.' ),
					'usage-statistics'
				),
				setting(
					__( 'When adding a site' ),
					__( 'Choose what Add site opens on.' ),
					'new-site-behavior'
				),
				setting(
					__( 'When Studio quits' ),
					__( 'Choose what happens to running sites when you quit Studio.' ),
					'quit-behavior'
				),
				setting(
					__( 'Start site when sending a prompt' ),
					__( 'Automatically start stopped sites when you send a chat message.' ),
					'auto-start-site'
				),
				setting(
					__( 'Show recent chats' ),
					__( 'Show recent chats in the sidebar.' ),
					'show-recent-chats'
				),
				setting(
					__( 'Collapse sidebar groups' ),
					__( 'Opening each site closes all others.' ),
					'collapse-sidebar-groups'
				),
				setting(
					__( 'Confirm before deleting annotations' ),
					__( 'Ask before deleting pending notes and attached images.' ),
					'confirm-delete-annotations'
				),
				setting(
					__( 'Reset interface' ),
					__( 'Restore default panel widths, theme, and interface settings.' ),
					'reset-interface'
				),
				setting(
					__( 'Studio CLI for terminal' ),
					__( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ),
					'studio-cli'
				),
				setting(
					__( 'Documentation' ),
					__( 'Guides for building and managing sites with Studio.' ),
					'documentation'
				),
				setting(
					__( 'Report an issue' ),
					__( 'Report a bug or request a feature.' ),
					'report-issue'
				),
			],
		},
		{
			id: 'appearance',
			label: __( 'Appearance' ),
			icon: AppearanceIcon,
			settings: [ setting( __( 'Theme' ), __( 'Choose light, dark, or system.' ), 'theme' ) ],
		},
		{
			id: 'sharing',
			label: __( 'Sharing' ),
			icon: ShareIcon,
			settings: [
				setting(
					__( 'Sharing previews on WordPress.com' ),
					__( 'Share a temporary copy of your local site with anyone.' ),
					'preview-sites'
				),
				setting( __( 'Live previews' ) ),
			],
		},
		{
			id: 'ai',
			label: __( 'AI Providers' ),
			icon: IntelligenceIcon,
			settings: [
				setting(
					__( 'Studio Code' ),
					__( 'Chat with an agent that builds and edits your sites.' ),
					'studio-code'
				),
				setting(
					__( 'WordPress.com' ),
					__( 'Get started with a one-time free allowance, then buy more as you go.' ),
					'wpcom-provider'
				),
				setting(
					__( 'Anthropic' ),
					__( 'Use Claude with your own API key.' ),
					'anthropic-provider'
				),
				setting(
					__( 'Default provider' ),
					__( 'The provider new chats use.' ),
					'default-provider'
				),
			],
		},
		{
			id: 'mcp',
			label: __( 'MCP' ),
			icon: McpIcon,
			settings: [
				setting( __( 'MCP server' ), __( 'Connect other AI assistants to Studio.' ), 'mcp-server' ),
			],
		},
		{
			id: 'usage',
			label: __( 'Usage' ),
			icon: ChartNoAxesColumnIncreasingIcon,
			settings: [
				setting( __( 'AI credits' ), __( 'Studio Code AI credits.' ), 'ai-credits' ),
				setting( __( 'Preview sites' ), __( 'Track your preview site usage.' ) ),
			],
		},
		{
			id: 'skills',
			label: __( 'Skills' ),
			icon: SkillsIcon,
			settings: [
				setting(
					__( 'WordPress skills' ),
					__(
						'Turn on WordPress skills for existing and new sites. Manage individual skills below.'
					),
					'wordpress-skills'
				),
			],
		},
		{
			id: 'instructions',
			label: __( 'Instructions' ),
			icon: FileTextIcon,
			settings: [
				setting(
					__( 'Agent instructions' ),
					__(
						'Set coding standards, preferred tools, and response style for new chats across all sites.'
					),
					'agent-instructions'
				),
			],
		},
		{ id: 'keyboard', label: __( 'Keyboard' ), icon: KeyboardIcon, settings: [] },
	];
	return sections.filter( ( section ) => signedIn || section.id !== 'usage' );
}

function getSiteSections(): Section[] {
	return [
		{
			id: 'site',
			label: __( 'Settings' ),
			icon: SiteSettingsIcon,
			settings: [
				setting( __( 'Site name' ), __( 'Name shown in Studio.' ) ),
				setting( __( 'WordPress version' ), __( 'Choose the WordPress release for this site.' ) ),
				setting(
					__( 'Automatic updates' ),
					__( 'Keep WordPress updated to the latest released version.' )
				),
				setting( __( 'Use custom domain' ), __( 'Use a local address like my-site.local.' ) ),
				setting(
					__( 'Enable HTTPS' ),
					__( 'Test features that require HTTPS and catch issues before your site goes live.' )
				),
				setting( __( 'Username' ), __( 'The username used to log in to WordPress Admin.' ) ),
				setting( __( 'Password' ), __( 'The password used to log in to WordPress Admin.' ) ),
				setting( __( 'Email' ), __( 'The email address used to log in to WordPress Admin.' ) ),
			],
		},
		{
			id: 'debugging',
			label: __( 'Debug' ),
			icon: BugIcon,
			settings: [
				setting(
					__( 'Environment' ),
					__( 'Sets the value returned by wp_get_environment_type().' )
				),
				setting( __( 'Xdebug' ), __( 'Connect a debugger to inspect PHP execution.' ) ),
				setting( __( 'Debug log' ), __( 'Write PHP errors to wp-content/debug.log.' ) ),
				setting(
					__( 'Script debugging' ),
					__( 'Load unminified WordPress JavaScript and CSS for easier debugging.' )
				),
				setting(
					__( 'Show errors in browser' ),
					__( 'Display PHP errors, warnings, and notices.' )
				),
			],
		},
		{
			id: 'php',
			label: __( 'PHP' ),
			icon: PhpIcon,
			settings: [
				setting( __( 'PHP version' ), __( 'The PHP version used to run WordPress on this site.' ) ),
				setting(
					__( 'File access' ),
					__(
						'Choose whether this site can access only its own folder or other files on your computer.'
					)
				),
			],
		},
		{
			id: 'site-skills',
			label: __( 'Skills' ),
			icon: SkillsIcon,
			settings: [ setting( __( 'Skills on this site' ) ) ],
		},
		{
			id: 'site-instructions',
			label: __( 'Instructions' ),
			icon: FileTextIcon,
			settings: [ setting( __( 'Instructions on this site' ) ) ],
		},
	];
}

export function getSections( scope: SettingsScope, { signedIn = true } = {} ): Section[] {
	return scope === 'studio' ? getStudioSections( signedIn ) : getSiteSections();
}

// The id of a Studio setting titled `title`, for its copy-link button.
export function findSettingId( title: string ): string | undefined {
	return getStudioSections( true )
		.flatMap( ( section ) => section.settings )
		.find( ( entry ) => entry.title === title )?.id;
}

// Where a settings link opens. An id this version doesn't know opens General,
// and the dialog reports it.
export function resolveSettingsLink( id: string ): SettingsSectionId {
	return (
		getStudioSections( true ).find( ( section ) =>
			section.settings.some( ( entry ) => entry.id === id )
		)?.id ?? 'general'
	);
}

export type SearchResult = { scope: SettingsScope; section: Section; setting?: Setting };

/**
 * Settings whose title or description has every word of `query`: exact title
 * matches first, then title matches, then description matches, each with the
 * current scope ahead of the other.
 */
export function searchSettings(
	query: string,
	scope: SettingsScope,
	{ hasSite, signedIn }: { hasSite: boolean; signedIn: boolean }
): SearchResult[] {
	const words = query.trim().toLocaleLowerCase().split( /\s+/ ).filter( Boolean );
	if ( ! words.length ) {
		return [];
	}
	const phrase = words.join( ' ' );
	const scopes: SettingsScope[] = hasSite
		? [ scope, scope === 'site' ? 'studio' : 'site' ]
		: [ 'studio' ];
	const rank = ( title: string ) => {
		const lower = title.toLocaleLowerCase();
		return lower === phrase ? 0 : words.every( ( word ) => lower.includes( word ) ) ? 1 : 2;
	};
	return scopes
		.flatMap( ( candidate, scopeIndex ) =>
			getSections( candidate, { signedIn } ).flatMap( ( section ) =>
				[ setting( section.label ), ...section.settings ]
					.filter( ( entry ) =>
						words.every( ( word ) =>
							`${ entry.title } ${ entry.description }`.toLocaleLowerCase().includes( word )
						)
					)
					.map( ( entry ) => ( {
						result: {
							scope: candidate,
							section,
							setting: entry.title === section.label && ! entry.id ? undefined : entry,
						},
						order: rank( entry.title ) * 2 + scopeIndex,
					} ) )
			)
		)
		.sort( ( a, b ) => a.order - b.order )
		.map( ( { result } ) => result );
}
