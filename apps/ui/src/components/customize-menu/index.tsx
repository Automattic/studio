import { __, sprintf } from '@wordpress/i18n';
import {
	desktop,
	layout,
	media,
	navigation,
	pages,
	pencil,
	plugins as pluginsIcon,
	postList,
	styles as stylesIcon,
	symbolFilled,
	tool,
	widget,
	wordpress,
} from '@wordpress/icons';
import { useState } from 'react';
import * as Menu from '@/components/menu';
import { QuickMenuItem, QuickMenuPopup, QuickMenuTrigger } from '@/components/site-quick-menu';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { usePluginSiteTag } from '@/lib/plugin-prototype';
import type { SiteDetails } from '@/data/core';
import type { ReactElement } from 'react';

const LAST_USED_STORAGE_KEY = 'studio:customize-menu:last-used';

interface CustomizeLink {
	id: string;
	icon: ReactElement;
	label: string;
	url: string;
}

function getStoredLinkId(): string | null {
	try {
		return window.localStorage.getItem( LAST_USED_STORAGE_KEY );
	} catch {
		return null;
	}
}

export function CustomizeMenu( { site }: { site: SiteDetails } ) {
	const openSiteUrl = useOpenSiteUrl( site );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	// Prototype: plugin sites lead with plugin-development destinations
	// instead of the theme-editing surfaces.
	const pluginTag = usePluginSiteTag( site.id );
	const [ lastUsedId, setLastUsedId ] = useState( getStoredLinkId );

	const busy = isStarting || isStopping;
	const themeDetails = site.themeDetails;
	const isBlockTheme = themeDetails?.isBlockTheme === true;

	const pluginLinks: CustomizeLink[] = [
		{
			id: 'plugins',
			icon: pluginsIcon,
			label: __( 'Plugins' ),
			url: '/wp-admin/plugins.php',
		},
		{
			id: 'site-health',
			icon: tool,
			label: __( 'Site Health' ),
			url: '/wp-admin/site-health.php',
		},
	];

	const themeLinks: CustomizeLink[] = isBlockTheme
		? [
				{
					id: 'site-editor',
					icon: desktop,
					label: __( 'Site Editor' ),
					url: '/wp-admin/site-editor.php',
				},
				{
					id: 'styles',
					icon: stylesIcon,
					label: __( 'Styles' ),
					url: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
				},
				{
					id: 'patterns',
					icon: symbolFilled,
					label: __( 'Patterns' ),
					url: '/wp-admin/site-editor.php?path=%2Fpatterns',
				},
				{
					id: 'navigation',
					icon: navigation,
					label: __( 'Navigation' ),
					url: '/wp-admin/site-editor.php?path=%2Fnavigation',
				},
				{
					id: 'templates',
					icon: layout,
					label: __( 'Templates' ),
					url: '/wp-admin/site-editor.php?path=%2Fwp_template',
				},
		  ]
		: [
				{
					id: 'customizer',
					icon: pencil,
					label: __( 'Customizer' ),
					url: '/wp-admin/customize.php',
				},
				...( themeDetails?.supportsMenus
					? [
							{
								id: 'menus',
								icon: navigation,
								label: __( 'Menus' ),
								url: '/wp-admin/nav-menus.php',
							},
					  ]
					: [] ),
				...( themeDetails?.supportsWidgets
					? [
							{
								id: 'widgets',
								icon: widget,
								label: __( 'Widgets' ),
								url: '/wp-admin/widgets.php',
							},
					  ]
					: [] ),
		  ];
	const contentLinks: CustomizeLink[] = [
		{ id: 'posts', icon: postList, label: __( 'Posts' ), url: '/wp-admin/edit.php' },
		{ id: 'pages', icon: pages, label: __( 'Pages' ), url: '/wp-admin/edit.php?post_type=page' },
		{ id: 'media', icon: media, label: __( 'Media Library' ), url: '/wp-admin/upload.php' },
	];
	const adminLink: CustomizeLink = {
		id: 'wp-admin',
		icon: wordpress,
		label: __( 'WP Admin' ),
		url: '/wp-admin/',
	};

	const customizeLinks = pluginTag ? pluginLinks : themeLinks;
	const allLinks = [ ...customizeLinks, ...contentLinks, adminLink ];
	// The trigger's default action is the link the user opened last; fall
	// back to the group's main surface (Plugins screen for plugin sites,
	// Site Editor / Customizer otherwise).
	const lastUsed = allLinks.find( ( link ) => link.id === lastUsedId ) ?? customizeLinks[ 0 ];

	const openLink = ( link: CustomizeLink ) => {
		setLastUsedId( link.id );
		try {
			window.localStorage.setItem( LAST_USED_STORAGE_KEY, link.id );
		} catch {
			// Storage failures only mean the trigger icon won't persist.
		}
		void openSiteUrl( link.url );
	};

	const linkItem = ( link: CustomizeLink ) => (
		<QuickMenuItem
			key={ link.id }
			icon={ link.icon }
			label={ link.label }
			disabled={ busy }
			onClick={ () => openLink( link ) }
		/>
	);

	return (
		<Menu.Root modal={ false }>
			<QuickMenuTrigger
				menuLabel={ __( 'Open WordPress…' ) }
				actionLabel={ sprintf(
					// translators: %s is a WP Admin destination, e.g. "Site Editor".
					__( 'Open %s' ),
					lastUsed.label
				) }
				logo={ lastUsed.icon }
				onActionClick={ () => openLink( lastUsed ) }
			/>
			<QuickMenuPopup>
				{ customizeLinks.map( linkItem ) }
				<Menu.Separator />
				{ contentLinks.map( linkItem ) }
				<Menu.Separator />
				{ linkItem( adminLink ) }
			</QuickMenuPopup>
		</Menu.Root>
	);
}
