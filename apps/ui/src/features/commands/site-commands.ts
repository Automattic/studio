import { __, sprintf } from '@wordpress/i18n';
import {
	ArrowRightLeftIcon,
	CodeIcon,
	DatabaseIcon,
	DownloadIcon,
	EyeIcon,
	EyeOffIcon,
	FolderIcon,
	PencilIcon,
	RefreshCwIcon,
	TerminalIcon,
	UploadIcon,
	XIcon,
} from 'lucide-react';
import {
	AnnotateIcon,
	ChatIcon,
	DuplicateIcon,
	ExternalLinkIcon,
	NewChatIcon,
	PinIcon,
	RotateCwIcon,
	ShareIcon,
	SiteSettingsIcon,
	StartSiteIcon,
	StopOtherSitesIcon,
	StopSiteIcon,
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
	'wp-admin': WordPressIcon,
	files: FolderIcon,
	editor: CodeIcon,
	terminal: TerminalIcon,
	phpmyadmin: DatabaseIcon,
};

export function getSiteCommands( {
	site,
	chatHidden,
	previewShown,
	canAnnotate,
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
	showPreview,
	setChatHidden,
	copyUrl,
}: {
	site: SiteDetails;
	chatHidden?: boolean;
	previewShown: boolean;
	canAnnotate: boolean;
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
	showPreview: ( open: boolean ) => void;
	setChatHidden: ( hidden: boolean ) => void;
	copyUrl: () => void;
} ): PaletteCommand[] {
	const { busy, running, othersRunning } = actions;
	const description = site.name;
	const keywords: Record< string, string[] > = {
		files: [ __( 'Folder' ), __( 'Directory' ), __( 'Finder' ) ],
		editor: [ __( 'Code editor' ), __( 'IDE' ) ],
		terminal: [ __( 'Shell' ), __( 'Command line' ) ],
		phpmyadmin: [ __( 'Database' ), 'SQL', 'MySQL' ],
		'wp-admin': [ __( 'Dashboard' ), 'wp-admin' ],
	};

	return [
		{
			id: 'new-chat',
			group: 'quick',
			label: __( 'New chat' ),
			icon: NewChatIcon,
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
						icon: site.running ? StopSiteIcon : StartSiteIcon,
						description,
						run: actions.toggleRunning,
					},
			  ] ),
		{
			id: 'site-settings',
			group: 'quick',
			label: __( 'Site settings' ),
			icon: SiteSettingsIcon,
			priority: 2,
			description,
			run: () => openSettings( 'site', site.id ),
		},
		{
			id: 'rename-site',
			group: 'site',
			label: __( 'Rename site…' ),
			icon: PencilIcon,
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
						icon: WordPressIcon,
						description,
						keywords: keywords[ 'wp-admin' ],
						run: actions.openAdmin,
					},
					{
						id: 'database',
						group: 'site' as const,
						label: __( 'Open database' ),
						icon: DatabaseIcon,
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
									group: 'site' as const,
									label: __( 'Stop other sites' ),
									icon: StopOtherSitesIcon,
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
						icon: StopOtherSitesIcon,
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
					icon: OPEN_IN_ICONS[ destination.id ],
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
						icon: RefreshCwIcon,
						keywords: [ __( 'Refresh' ) ],
						run: reloadPreview,
					},
			  ]
			: [] ),
		...( previewShown && site.running && ( canAnnotate || annotating )
			? [
					{
						id: 'annotate',
						group: 'site' as const,
						label: annotating ? __( 'Exit annotations' ) : __( 'Annotate' ),
						icon: annotating ? XIcon : AnnotateIcon,
						description,
						run: () => annotate( ! annotating ),
					},
			  ]
			: [] ),
		{
			id: 'preview-visibility',
			group: 'site',
			label: previewShown ? __( 'Hide preview' ) : __( 'Show preview' ),
			icon: previewShown ? EyeOffIcon : EyeIcon,
			description,
			run: () => showPreview( ! previewShown ),
		},
		...( chatHidden === undefined
			? []
			: [
					{
						id: 'chat-visibility',
						group: 'site' as const,
						label: chatHidden ? __( 'Show chat' ) : __( 'Hide chat' ),
						icon: ChatIcon,
						run: () => setChatHidden( ! chatHidden ),
					},
			  ] ),
		{
			id: 'share',
			group: 'site',
			label: __( 'Share site…' ),
			icon: ShareIcon,
			description,
			keywords: [ __( 'preview link' ) ],
			run: () => openHeaderPanel( { panel: 'share', siteId: site.id } ),
		},
		{
			id: 'publish',
			group: 'site',
			label: __( 'Publish & Sync…' ),
			icon: ArrowRightLeftIcon,
			description,
			keywords: [ __( 'publish site sync push pull upload download' ) ],
			run: () => openHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ),
		},
		{
			id: 'copy-url',
			group: 'site',
			label: __( 'Copy site URL' ),
			icon: DuplicateIcon,
			description,
			keywords: [ __( 'Address' ), __( 'Link' ) ],
			run: copyUrl,
		},
		{
			id: 'pin-site',
			group: 'site',
			label: actions.pinned ? __( 'Unpin site' ) : __( 'Pin site' ),
			icon: actions.pinned ? UnpinIcon : PinIcon,
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
					icon: {
						duplicate: DuplicateIcon,
						import: UploadIcon,
						export: DownloadIcon,
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
