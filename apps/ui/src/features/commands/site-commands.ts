import { __, sprintf } from '@wordpress/i18n';
import { getSettingsCommandAliases } from '@/data/settings-sections';
import {
	XIcon,
	AnnotateIcon,
	CodeIcon,
	DatabaseIcon,
	DuplicateIcon,
	FileArchiveIcon,
	ExternalLinkIcon,
	FolderIcon,
	DownloadIcon,
	PaperPlaneIcon,
	SquarePenIcon,
	PinIcon,
	PencilIcon,
	RotateCwIcon,
	UploadIcon,
	SlidersVerticalIcon,
	PlayIcon,
	CircleStopIcon,
	SquareIcon,
	CloudUploadIcon,
	TerminalIcon,
	UnpinIcon,
	WordPressIcon,
} from '@/lib/icons';
import type { SiteDetails } from '@/data/core';
import type { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import type { useOpenSettings } from '@/data/use-open-settings';
import type { PaletteCommand } from '@/features/commands/studio-commands';
import type {
	OpenInDestination,
	useOpenInDestinations,
	useSiteActions,
	useSiteManagementActions,
} from '@/features/sites';

const OPEN_IN_ICONS: Record< OpenInDestination, PaletteCommand[ 'icon' ] > = {
	browser: ExternalLinkIcon,
	'browser-wordpress': ExternalLinkIcon,
	'wp-admin': WordPressIcon,
	files: FolderIcon,
	editor: CodeIcon,
	terminal: TerminalIcon,
	phpmyadmin: DatabaseIcon,
};

export function getSiteCommands( {
	site,
	panelShown,
	canAnnotate,
	nativeSites,
	annotating,
	actions,
	destinations,
	manage,
	settingCommands,
	openSettings,
	openHeaderPanel,
	newChat,
	reloadPreview,
	annotate,
	copyUrl,
}: {
	site: SiteDetails;
	panelShown: boolean;
	canAnnotate: boolean;
	nativeSites: boolean;
	annotating: boolean;
	actions: ReturnType< typeof useSiteActions >;
	destinations: ReturnType< typeof useOpenInDestinations >;
	manage: ReturnType< typeof useSiteManagementActions >;
	settingCommands: PaletteCommand[];
	openSettings: ReturnType< typeof useOpenSettings >;
	openHeaderPanel: ReturnType< typeof useOpenHeaderPanel >;
	newChat: () => void;
	reloadPreview: () => void;
	annotate: ( active: boolean ) => void;
	copyUrl: () => void;
} ): PaletteCommand[] {
	const { busy, running, othersRunning } = actions;
	const description = site.name;
	const keywords: Record< string, string[] > = {
		files: [ __( 'Folder' ), __( 'Directory' ), __( 'Finder' ) ],
		editor: [ __( 'Code editor' ), __( 'IDE' ) ],
		terminal: [ __( 'Shell' ), __( 'Command line' ) ],
		phpmyadmin: [ __( 'Database' ), 'phpMyAdmin', 'SQL', 'MySQL' ],
		'wp-admin': [ __( 'Dashboard' ), 'wp-admin' ],
	};

	return [
		{
			id: 'new-chat',
			group: 'quick',
			label: __( 'New chat' ),
			icon: SquarePenIcon,
			priority: 1,
			description,
			aliases: [ __( 'Add chat' ), __( 'Create chat' ) ],
			run: newChat,
		},
		...( busy
			? []
			: [
					{
						id: 'lifecycle',
						group: 'quick' as const,
						label: site.running ? __( 'Stop site' ) : __( 'Start site' ),
						icon: site.running ? SquareIcon : PlayIcon,
						description,
						run: actions.toggleRunning,
					},
			  ] ),
		{
			id: 'site-settings',
			group: 'quick',
			label: __( 'Site settings' ),
			aliases: getSettingsCommandAliases( 'site', 'site-settings' ),
			icon: SlidersVerticalIcon,
			priority: 2,
			description,
			run: () => openSettings( 'site', site.id ),
		},
		{
			id: 'rename-site',
			group: 'commands',
			label: __( 'Rename site…' ),
			aliases: getSettingsCommandAliases( 'site', 'rename-site' ),
			icon: PencilIcon,
			description,
			run: actions.rename,
		},
		...( busy
			? []
			: [
					{
						id: 'admin',
						group: 'commands' as const,
						label: __( 'Open WordPress Admin' ),
						icon: WordPressIcon,
						description,
						keywords: keywords[ 'wp-admin' ],
						run: actions.openAdmin,
					},
					...( nativeSites
						? [
								{
									id: 'database',
									group: 'commands' as const,
									label: __( 'Open database' ),
									icon: DatabaseIcon,
									description,
									keywords: keywords.phpmyadmin,
									run: actions.openDatabase,
								},
								{
									id: 'email',
									group: 'commands' as const,
									label: __( 'Open email log' ),
									icon: PaperPlaneIcon,
									description,
									keywords: [ __( 'Inbox' ), __( 'Mail' ), 'wp_mail' ],
									run: actions.openEmail,
								},
						  ]
						: [] ),
					...( site.running
						? [
								{
									id: 'restart',
									group: 'commands' as const,
									label: __( 'Restart site' ),
									icon: RotateCwIcon,
									description,
									run: () => void actions.restart(),
								},
						  ]
						: [] ),
					...( site.running && othersRunning.length
						? [
								{
									id: 'stop-others',
									group: 'commands' as const,
									label: __( 'Stop other sites' ),
									icon: CircleStopIcon,
									run: () => actions.stop( othersRunning ),
								},
						  ]
						: [] ),
			  ] ),
		...( running.length > 1
			? [
					{
						id: 'stop-all',
						group: 'commands' as const,
						label: __( 'Stop all sites' ),
						icon: CircleStopIcon,
						run: () => actions.stop( running ),
					},
			  ]
			: [] ),
		...destinations
			.filter(
				( destination ) =>
					! destination.disabled && destination.id !== 'wp-admin' && destination.id !== 'phpmyadmin'
			)
			.map(
				( destination ): PaletteCommand => ( {
					id: `open-${ destination.id }`,
					group: 'commands',
					label:
						destination.id === 'browser-wordpress'
							? __( 'Open WordPress in browser' )
							: sprintf(
									/* translators: %s is the name of the app. E.g. "Open in Cursor" */
									__( 'Open in %s' ),
									destination.label
							  ),
					icon: OPEN_IN_ICONS[ destination.id ],
					description,
					keywords: keywords[ destination.id ],
					run: destination.open,
				} )
			),
		...( panelShown && site.running
			? [
					{
						id: 'reload',
						group: 'commands' as const,
						label: __( 'Reload' ),
						icon: RotateCwIcon,
						keywords: [ __( 'Refresh' ) ],
						run: reloadPreview,
					},
			  ]
			: [] ),
		...( panelShown && site.running && ( canAnnotate || annotating )
			? [
					{
						id: 'annotate',
						group: 'commands' as const,
						label: annotating ? __( 'Exit annotations' ) : __( 'Annotate' ),
						icon: annotating ? XIcon : AnnotateIcon,
						description,
						run: () => annotate( ! annotating ),
					},
			  ]
			: [] ),
		{
			id: 'share',
			group: 'commands',
			label: __( 'Share site…' ),
			icon: UploadIcon,
			description,
			keywords: [ __( 'preview link' ) ],
			run: () => openHeaderPanel( { panel: 'share', siteId: site.id } ),
		},
		{
			id: 'publish',
			group: 'commands',
			label: __( 'Publish' ),
			icon: CloudUploadIcon,
			description,
			keywords: [ __( 'publish site sync push pull upload download' ) ],
			run: () => openHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ),
		},
		{
			id: 'copy-url',
			group: 'commands',
			label: __( 'Copy site URL' ),
			icon: DuplicateIcon,
			description,
			keywords: [ __( 'Address' ), __( 'Link' ) ],
			run: copyUrl,
		},
		{
			id: 'pin-site',
			group: 'commands',
			label: actions.pinned ? __( 'Unpin' ) : __( 'Pin' ),
			icon: actions.pinned ? UnpinIcon : PinIcon,
			description,
			run: actions.togglePin,
		},
		...manage
			.filter( ( action ) => action.id !== 'delete' && ! action.disabled )
			.map(
				( action ): PaletteCommand => ( {
					id: action.id,
					group: 'commands',
					label:
						action.id === 'duplicate'
							? __( 'Duplicate site' )
							: action.id === 'import'
							? __( 'Import backup…' )
							: action.label,
					icon: {
						duplicate: DuplicateIcon,
						import: DownloadIcon,
						export: FileArchiveIcon,
						'export-db': DatabaseIcon,
						delete: action.icon,
					}[ action.id ],
					description,
					keywords: [ __( 'Backup' ) ],
					run: action.run,
				} )
			),
		...settingCommands,
	];
}
