import { __ } from '@wordpress/i18n';
import {
	archive,
	brush,
	category,
	code,
	cog,
	comment,
	dashboard,
	desktop,
	layout,
	login,
	media,
	navigation,
	page,
	pages,
	people,
	plugins,
	post,
	reusableBlock,
	rss,
	settings as settingsIcon,
	styles as stylesIcon,
	symbolFilled,
} from '@wordpress/icons';
import type { ReactElement } from 'react';

type TabIcon = ReactElement;

const PREVIEW_PATH_BASE = 'https://studio.local';

export function getWordPressTabIcon( path: string ): TabIcon | null {
	const parsed = getParsedPreviewPath( path );
	if ( ! parsed ) {
		return null;
	}

	const pathname = parsed.pathname.toLowerCase();
	const searchParams = parsed.searchParams;

	if ( pathname === '/wp-login.php' ) {
		return login;
	}
	if ( pathname.startsWith( '/wp-json/' ) ) {
		return code;
	}
	if ( pathname.endsWith( '/feed/' ) || pathname.endsWith( '/feed' ) ) {
		return rss;
	}
	if ( ! pathname.startsWith( '/wp-admin' ) ) {
		return null;
	}

	return getWpAdminTabIcon( pathname, searchParams );
}

export function getWordPressTabTitle( path: string ): string | null {
	const parsed = getParsedPreviewPath( path );
	if ( ! parsed ) {
		return null;
	}

	const pathname = parsed.pathname.toLowerCase();
	const searchParams = parsed.searchParams;

	if ( pathname === '/wp-login.php' ) {
		return __( 'Log in' );
	}
	if ( pathname.startsWith( '/wp-json/' ) ) {
		return __( 'REST API' );
	}
	if ( pathname.endsWith( '/feed/' ) || pathname.endsWith( '/feed' ) ) {
		return __( 'Feed' );
	}
	if ( ! pathname.startsWith( '/wp-admin' ) ) {
		return null;
	}

	return getWpAdminTabTitle( pathname, searchParams );
}

function getParsedPreviewPath( path: string ) {
	try {
		return new URL( path || '/', PREVIEW_PATH_BASE );
	} catch {
		return null;
	}
}

function getWpAdminTabIcon( pathname: string, searchParams: URLSearchParams ): TabIcon {
	const adminFile = getWpAdminFile( pathname );

	switch ( adminFile ) {
		case 'index.php':
			return dashboard;
		case 'edit.php':
			return getPostTypeIcon( searchParams, post, pages );
		case 'post.php':
		case 'post-new.php':
			return getPostTypeIcon( searchParams, post, page );
		case 'upload.php':
		case 'media-new.php':
		case 'async-upload.php':
			return media;
		case 'edit-comments.php':
		case 'comment.php':
			return comment;
		case 'edit-tags.php':
		case 'term.php':
			return category;
		case 'themes.php':
		case 'theme-install.php':
		case 'theme-editor.php':
		case 'customize.php':
			return brush;
		case 'site-editor.php':
			return getSiteEditorIcon( searchParams );
		case 'nav-menus.php':
			return navigation;
		case 'widgets.php':
			return layout;
		case 'plugins.php':
		case 'plugin-install.php':
		case 'plugin-editor.php':
			return plugins;
		case 'users.php':
		case 'user-new.php':
		case 'profile.php':
		case 'user-edit.php':
			return people;
		case 'options-general.php':
		case 'options-writing.php':
		case 'options-reading.php':
		case 'options-discussion.php':
		case 'options-media.php':
		case 'options-permalink.php':
		case 'options-privacy.php':
			return settingsIcon;
		case 'tools.php':
		case 'import.php':
		case 'export.php':
		case 'site-health.php':
			return archive;
		case 'admin.php':
			return getAdminPageIcon( searchParams );
		default:
			return cog;
	}
}

function getWpAdminTabTitle( pathname: string, searchParams: URLSearchParams ): string {
	const adminFile = getWpAdminFile( pathname );

	switch ( adminFile ) {
		case 'index.php':
			return __( 'Dashboard' );
		case 'edit.php':
			return getPostTypeTitle( searchParams, __( 'Posts' ), __( 'Pages' ) );
		case 'post.php':
			return getPostTypeTitle( searchParams, __( 'Edit post' ), __( 'Edit page' ) );
		case 'post-new.php':
			return getPostTypeTitle( searchParams, __( 'New post' ), __( 'New page' ) );
		case 'upload.php':
		case 'media-new.php':
		case 'async-upload.php':
			return __( 'Media' );
		case 'edit-comments.php':
		case 'comment.php':
			return __( 'Comments' );
		case 'edit-tags.php':
		case 'term.php':
			return __( 'Terms' );
		case 'themes.php':
		case 'theme-install.php':
		case 'theme-editor.php':
			return __( 'Themes' );
		case 'customize.php':
			return __( 'Customize' );
		case 'site-editor.php':
			return getSiteEditorTitle( searchParams );
		case 'nav-menus.php':
			return __( 'Menus' );
		case 'widgets.php':
			return __( 'Widgets' );
		case 'plugins.php':
		case 'plugin-install.php':
		case 'plugin-editor.php':
			return __( 'Plugins' );
		case 'users.php':
		case 'user-new.php':
		case 'profile.php':
		case 'user-edit.php':
			return __( 'Users' );
		case 'options-general.php':
		case 'options-writing.php':
		case 'options-reading.php':
		case 'options-discussion.php':
		case 'options-media.php':
		case 'options-permalink.php':
		case 'options-privacy.php':
			return __( 'Settings' );
		case 'tools.php':
			return __( 'Tools' );
		case 'import.php':
			return __( 'Import' );
		case 'export.php':
			return __( 'Export' );
		case 'site-health.php':
			return __( 'Site Health' );
		case 'admin.php':
			return getAdminPageTitle( searchParams );
		default:
			return __( 'Admin' );
	}
}

function getWpAdminFile( pathname: string ) {
	const normalizedPath = pathname.replace( /\/+$/g, '' );
	if ( normalizedPath === '/wp-admin' ) {
		return 'index.php';
	}

	return normalizedPath.split( '/' ).pop() || 'index.php';
}

function getPostTypeIcon(
	searchParams: URLSearchParams,
	defaultIcon: TabIcon,
	pageIcon: TabIcon
): TabIcon {
	const postType = getPostType( searchParams );
	if ( postType === 'page' ) {
		return pageIcon;
	}
	if ( postType === 'attachment' ) {
		return media;
	}
	if ( postType === 'wp_template' || postType === 'wp_template_part' ) {
		return layout;
	}
	if ( postType === 'wp_block' ) {
		return reusableBlock;
	}
	return defaultIcon;
}

function getPostTypeTitle(
	searchParams: URLSearchParams,
	defaultTitle: string,
	pageTitle: string
): string {
	const postType = getPostType( searchParams );
	if ( postType === 'page' ) {
		return pageTitle;
	}
	if ( postType === 'attachment' ) {
		return __( 'Media' );
	}
	if ( postType === 'wp_template' || postType === 'wp_template_part' ) {
		return __( 'Templates' );
	}
	if ( postType === 'wp_block' ) {
		return __( 'Patterns' );
	}
	return defaultTitle;
}

function getSiteEditorIcon( searchParams: URLSearchParams ): TabIcon {
	const editorPath = ( searchParams.get( 'path' ) ?? '' ).toLowerCase();
	const postType = getPostType( searchParams );

	if ( editorPath.includes( 'wp_global_styles' ) ) {
		return stylesIcon;
	}
	if ( editorPath.includes( 'patterns' ) || editorPath.includes( 'wp_block' ) ) {
		return symbolFilled;
	}
	if ( editorPath.includes( 'navigation' ) ) {
		return navigation;
	}
	if ( editorPath.includes( 'wp_template' ) || postType === 'wp_template' ) {
		return layout;
	}
	if ( editorPath.includes( 'page' ) || postType === 'page' ) {
		return pages;
	}

	return desktop;
}

function getSiteEditorTitle( searchParams: URLSearchParams ): string {
	const editorPath = ( searchParams.get( 'path' ) ?? '' ).toLowerCase();
	const postType = getPostType( searchParams );

	if ( editorPath.includes( 'wp_global_styles' ) ) {
		return __( 'Styles' );
	}
	if ( editorPath.includes( 'patterns' ) || editorPath.includes( 'wp_block' ) ) {
		return __( 'Patterns' );
	}
	if ( editorPath.includes( 'navigation' ) ) {
		return __( 'Navigation' );
	}
	if ( editorPath.includes( 'wp_template' ) || postType === 'wp_template' ) {
		return __( 'Templates' );
	}
	if ( editorPath.includes( 'page' ) || postType === 'page' ) {
		return __( 'Pages' );
	}

	return __( 'Site Editor' );
}

function getAdminPageIcon( searchParams: URLSearchParams ): TabIcon {
	const pageParam = ( searchParams.get( 'page' ) ?? '' ).toLowerCase();
	if ( pageParam.includes( 'site-editor' ) || pageParam.includes( 'gutenberg' ) ) {
		return desktop;
	}
	if ( pageParam.includes( 'theme' ) || pageParam.includes( 'custom' ) ) {
		return brush;
	}
	if ( pageParam.includes( 'plugin' ) ) {
		return plugins;
	}
	if ( pageParam.includes( 'settings' ) || pageParam.includes( 'options' ) ) {
		return settingsIcon;
	}
	return cog;
}

function getAdminPageTitle( searchParams: URLSearchParams ): string {
	const pageParam = ( searchParams.get( 'page' ) ?? '' ).toLowerCase();
	if ( pageParam.includes( 'site-editor' ) || pageParam.includes( 'gutenberg' ) ) {
		return __( 'Site Editor' );
	}
	if ( pageParam.includes( 'theme' ) || pageParam.includes( 'custom' ) ) {
		return __( 'Themes' );
	}
	if ( pageParam.includes( 'plugin' ) ) {
		return __( 'Plugins' );
	}
	if ( pageParam.includes( 'settings' ) || pageParam.includes( 'options' ) ) {
		return __( 'Settings' );
	}
	return __( 'Admin' );
}

function getPostType( searchParams: URLSearchParams ) {
	return ( searchParams.get( 'post_type' ) ?? searchParams.get( 'postType' ) ?? '' ).toLowerCase();
}
