import { __ } from '@wordpress/i18n';
import {
	BugIcon,
	ChartNoAxesColumnIncreasingIcon,
	CodeIcon,
	FileTextIcon,
	SettingsIcon,
	TerminalIcon,
} from 'lucide-react';
import {
	AppearanceIcon,
	IntelligenceIcon,
	KeyboardIcon,
	LanguageIcon,
	McpIcon,
	PhpIcon,
	ShareIcon,
	SiteSettingsIcon,
	SkillsIcon,
} from '@/lib/icons';
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
const SITE_SECTIONS = [ 'site', 'debugging', 'php', 'site-skills', 'site-instructions' ] as const;

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

type ExistingPaletteCommand = 'settings' | 'site-settings' | 'rename-site';
// Fold redundant rows into their section or an existing command; actions need a runtime handler.
type SettingPalette = 'navigate' | 'action' | 'section' | { command: ExistingPaletteCommand };

type Setting = {
	palette: SettingPalette;
	id?: string;
	title: string;
	description: string;
	icon?: SectionIcon;
	aliases?: string[];
};

type SectionIcon = ComponentType< { className?: string } >;

export type Section = {
	command?: ExistingPaletteCommand;
	id: SettingsSectionId;
	label: string;
	icon: SectionIcon;
	settings: Setting[];
	aliases?: string[];
};

const setting = (
	palette: SettingPalette,
	title: string,
	description = '',
	id?: string,
	icon?: SectionIcon
): Setting => ( {
	palette,
	id,
	title,
	description,
	icon,
} );

function getStudioSections( signedIn: boolean ): Section[] {
	const sections: Section[] = [
		{
			command: 'settings',
			id: 'general',
			label: __( 'General' ),
			icon: SettingsIcon,
			settings: [
				setting(
					'navigate',
					__( 'Language' ),
					__( 'Default language for WordPress Studio.' ),
					'language',
					LanguageIcon
				),
				setting(
					'navigate',
					__( 'Default code editor' ),
					__( 'The default code editor for your sites.' ),
					'code-editor',
					CodeIcon
				),
				setting(
					'navigate',
					__( 'Default browser' ),
					__( 'The browser used to open your sites, WP Admin, and phpMyAdmin.' ),
					'browser'
				),
				setting(
					'navigate',
					__( 'Default terminal app' ),
					__( 'The default terminal for your sites.' ),
					'terminal',
					TerminalIcon
				),
				setting(
					'navigate',
					__( 'Default directory' ),
					__( 'The folder where WordPress Studio creates new sites.' ),
					'default-directory'
				),
				setting(
					'action',
					__( 'Improve WordPress Studio for everyone' ),
					__( 'Share anonymous usage statistics to improve WordPress Studio.' ),
					'usage-statistics'
				),
				setting(
					'navigate',
					__( 'When adding a site' ),
					__( 'Choose a starting point or go straight to creating a blank site.' ),
					'new-site-behavior'
				),
				setting(
					'navigate',
					__( 'When WordPress Studio quits' ),
					__( 'Choose what happens to running sites when you quit WordPress Studio.' ),
					'quit-behavior'
				),
				setting(
					'action',
					__( 'Start site when sending a prompt' ),
					__( 'Automatically start stopped sites when you send a chat message.' ),
					'auto-start-site'
				),
				setting(
					'action',
					__( 'Show recent chats' ),
					__( 'Show recent chats in the sidebar.' ),
					'show-recent-chats'
				),
				setting(
					'action',
					__( 'Collapse sidebar groups' ),
					__( 'Opening each site closes all others.' ),
					'collapse-sidebar-groups'
				),
				setting(
					'action',
					__( 'Confirm before deleting annotations' ),
					__( 'Ask before deleting pending notes and attached images.' ),
					'confirm-delete-annotations'
				),
				setting(
					'action',
					__( 'Reset interface' ),
					__( 'Restore default panel widths, theme, colors, and interface settings.' ),
					'reset-interface'
				),
				setting(
					'navigate',
					__( 'WordPress Studio CLI for terminal' ),
					__( 'Use the studio command in any terminal to manage sites and run WP-CLI.' ),
					'studio-cli'
				),
				setting(
					'action',
					__( 'Documentation' ),
					__( 'Guides for building and managing sites with WordPress Studio.' ),
					'documentation'
				),
				setting(
					'action',
					__( 'Report an issue on GitHub' ),
					__( 'Report a bug or request a feature.' ),
					'report-issue'
				),
			],
		},
		{
			id: 'appearance',
			label: __( 'Appearance' ),
			icon: AppearanceIcon,
			settings: [
				setting(
					'navigate',
					__( 'Interface theme' ),
					__( 'Choose light, dark, or system.' ),
					'theme'
				),
				{
					...setting(
						'navigate',
						__( 'Accent' ),
						__( 'Studio adapts your chosen color to work with your theme.' ),
						'color'
					),
					aliases: [ __( 'Colour' ), __( 'Change color' ) ],
				},
				setting(
					'navigate',
					__( 'Intensity' ),
					__( 'Adjust the strength of the color tint.' ),
					'intensity'
				),
				setting(
					'navigate',
					__( 'Contrast' ),
					__( 'Increase separation between surfaces.' ),
					'contrast'
				),
				setting(
					'action',
					__( 'Reset appearance' ),
					__( 'Restore the default interface theme, accent color, intensity, and contrast.' ),
					'reset-appearance'
				),
			],
		},
		{
			id: 'sharing',
			label: __( 'Sharing' ),
			icon: ShareIcon,
			settings: [
				{
					...setting(
						'section',
						__( 'Sharing previews on WordPress.com' ),
						__( 'Share a temporary copy of your local site with anyone.' ),
						'preview-sites'
					),
					aliases: [ __( 'Snapshots' ) ],
				},
				setting( 'section', __( 'Live previews' ) ),
			],
		},
		{
			id: 'ai',
			label: __( 'AI Providers' ),
			icon: IntelligenceIcon,
			aliases: [ __( 'Connect provider' ) ],
			settings: [
				setting(
					'navigate',
					__( 'WordPress.com' ),
					__( 'Get started with a one-time free allowance, then buy more as you go.' ),
					'wpcom-provider'
				),
				setting(
					'navigate',
					__( 'Anthropic' ),
					__( 'Use Claude with your own API key.' ),
					'anthropic-provider'
				),
				setting(
					'navigate',
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
				setting(
					'section',
					__( 'MCP server' ),
					__( 'Connect other AI assistants to WordPress Studio.' ),
					'mcp-server'
				),
			],
		},
		{
			id: 'usage',
			label: __( 'Usage' ),
			icon: ChartNoAxesColumnIncreasingIcon,
			settings: [
				{
					...setting(
						'section',
						__( 'WordPress.com AI' ),
						__( 'Use AI credits to build sites, shape content, and refine your design.' ),
						'ai-credits'
					),
					aliases: [ __( 'Credit balance' ) ],
				},
				setting(
					'navigate',
					__( 'Add credits' ),
					__( 'Get more WordPress.com AI credits to keep building.' ),
					'add-credits'
				),
				setting(
					'navigate',
					__( 'Preview sites' ),
					__( 'Track your preview site usage.' ),
					'preview-site-usage'
				),
			],
		},
		{
			id: 'skills',
			label: __( 'Skills' ),
			icon: SkillsIcon,
			settings: [
				setting(
					'section',
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
					'section',
					__( 'Agent instructions' ),
					__(
						'Set coding standards, preferred tools, and response style for new chats across all sites.'
					),
					'agent-instructions'
				),
			],
		},
		{
			id: 'keyboard',
			label: __( 'Keyboard' ),
			icon: KeyboardIcon,
			settings: [],
			aliases: [ __( 'Keyboard shortcuts' ) ],
		},
	];
	return sections.filter( ( section ) => signedIn || section.id !== 'usage' );
}

function getSiteSections(): Section[] {
	return [
		{
			command: 'site-settings',
			id: 'site',
			label: __( 'Settings' ),
			icon: SiteSettingsIcon,
			settings: [
				setting(
					{ command: 'rename-site' },
					__( 'Site name' ),
					__( 'Name shown in WordPress Studio.' ),
					'site-name'
				),
				setting(
					'navigate',
					__( 'WordPress version' ),
					__( 'Choose the WordPress release for this site.' ),
					'wordpress-version'
				),
				setting(
					'navigate',
					__( 'Automatic updates' ),
					__( 'Keep WordPress updated to the latest released version.' ),
					'automatic-updates'
				),
				setting(
					'navigate',
					__( 'Use custom domain' ),
					__( 'Use a local address like my-site.local.' ),
					'custom-domain'
				),
				setting(
					'navigate',
					__( 'Enable HTTPS' ),
					__( 'Test features that require HTTPS and catch issues before your site goes live.' ),
					'https'
				),
				setting(
					'navigate',
					__( 'Username' ),
					__( 'The username used to log in to WordPress Admin.' ),
					'username'
				),
				setting(
					'navigate',
					__( 'Password' ),
					__( 'The password used to log in to WordPress Admin.' ),
					'password'
				),
				setting(
					'navigate',
					__( 'Email' ),
					__( 'The email address used to log in to WordPress Admin.' ),
					'email'
				),
			],
		},
		{
			id: 'debugging',
			label: __( 'Debug' ),
			icon: BugIcon,
			settings: [
				setting(
					'navigate',
					__( 'Environment' ),
					__( 'Sets the value returned by wp_get_environment_type().' ),
					'environment'
				),
				setting(
					'navigate',
					__( 'Xdebug' ),
					__( 'Connect a debugger to inspect PHP execution.' ),
					'xdebug'
				),
				setting(
					'navigate',
					__( 'Debug log' ),
					__( 'Write PHP errors to wp-content/debug.log.' ),
					'debug-log'
				),
				setting(
					'navigate',
					__( 'Script debugging' ),
					__( 'Load unminified WordPress JavaScript and CSS for easier debugging.' ),
					'script-debugging'
				),
				setting(
					'navigate',
					__( 'Show errors in browser' ),
					__( 'Display PHP errors, warnings, and notices.' ),
					'show-errors'
				),
			],
		},
		{
			id: 'php',
			label: __( 'PHP' ),
			icon: PhpIcon,
			settings: [
				setting(
					'navigate',
					__( 'PHP version' ),
					__( 'The PHP version used to run WordPress on this site.' ),
					'php-version'
				),
				setting(
					'navigate',
					__( 'File access' ),
					__(
						'Choose whether this site can access only its own folder or other files on your computer.'
					),
					'file-access'
				),
			],
		},
		{
			id: 'site-skills',
			label: __( 'Skills' ),
			icon: SkillsIcon,
			settings: [ setting( 'section', __( 'Skills on this site' ), '', 'site-wordpress-skills' ) ],
		},
		{
			id: 'site-instructions',
			label: __( 'Instructions' ),
			icon: FileTextIcon,
			settings: [
				setting( 'section', __( 'Instructions on this site' ), '', 'site-agent-instructions' ),
			],
		},
	];
}

export function getSections( scope: SettingsScope, { signedIn = true } = {} ): Section[] {
	return scope === 'studio' ? getStudioSections( signedIn ) : getSiteSections();
}

/** Alternate names for existing commands that already own a settings destination. */
export function getSettingsCommandAliases( scope: SettingsScope, command: ExistingPaletteCommand ) {
	return getSections( scope ).flatMap( ( section ) => [
		...( section.command === command ? [ section.label, ...( section.aliases ?? [] ) ] : [] ),
		...section.settings.flatMap( ( entry ) =>
			typeof entry.palette === 'object' && entry.palette.command === command
				? [ entry.title, ...( entry.aliases ?? [] ) ]
				: []
		),
	] );
}

// Stable row targets; only WordPress Studio settings expose copyable links.
export function findSettingId(
	title: string,
	scope: SettingsScope = 'studio'
): string | undefined {
	return getSections( scope )
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
 * Settings whose title, description or aliases have every word of `query`: exact title
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
				[
					{ ...setting( 'navigate', section.label ), aliases: section.aliases },
					...section.settings,
				]
					.filter( ( entry ) =>
						words.every( ( word ) =>
							[ entry.title, entry.description, ...( entry.aliases ?? [] ) ]
								.join( ' ' )
								.toLocaleLowerCase()
								.includes( word )
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
