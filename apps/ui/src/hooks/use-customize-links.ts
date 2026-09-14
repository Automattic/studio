import { __ } from '@wordpress/i18n';
import {
	desktop,
	layout,
	media,
	navigation,
	pages,
	pencil,
	postList,
	styles as stylesIcon,
	symbolFilled,
	widget,
	wordpress,
} from '@wordpress/icons';
import { useMemo } from 'react';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, SVGProps } from 'react';

export interface CustomizeLink {
	id: string;
	// Matches the element type `Icon` accepts, so links render via
	// `<Icon icon={ link.icon } />` without widening casts.
	icon: ReactElement< SVGProps< SVGSVGElement > >;
	label: string;
	url: string;
}

/**
 * The WP Admin destinations offered for a site, grouped the way the
 * "Open WordPress…" menus present them: a customize group (theme-editing
 * surfaces), a content group, and the WP Admin dashboard link.
 */
export function useCustomizeLinks( site: SiteDetails ): {
	customizeLinks: CustomizeLink[];
	contentLinks: CustomizeLink[];
	adminLink: CustomizeLink;
	allLinks: CustomizeLink[];
} {
	const themeDetails = site.themeDetails;

	// Memoized so consumers can feed the lists to identity-sensitive APIs
	// (the address bar hands them to Base UI as autocomplete items, which
	// re-renders on every items identity change).
	return useMemo( () => buildCustomizeLinks( { themeDetails } ), [ themeDetails ] );
}

function buildCustomizeLinks( { themeDetails }: { themeDetails: SiteDetails[ 'themeDetails' ] } ) {
	const isBlockTheme = themeDetails?.isBlockTheme === true;

	const customizeLinks: CustomizeLink[] = isBlockTheme
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

	return {
		customizeLinks,
		contentLinks,
		adminLink,
		allLinks: [ ...customizeLinks, ...contentLinks, adminLink ],
	};
}
