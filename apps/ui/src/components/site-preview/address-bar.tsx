import { __ } from '@wordpress/i18n';
import { globe, help, home, wordpress } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { Icon, Tooltip } from '@wordpress/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { databaseIcon } from '@/lib/icons';
import styles from './address-bar.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactElement, SVGProps } from 'react';

export function getPathFromPreviewUrl( url: string, baseUrl: string ) {
	try {
		const parsedUrl = new URL( url );
		const parsedBaseUrl = new URL( baseUrl );
		if ( parsedUrl.origin !== parsedBaseUrl.origin ) {
			return null;
		}
		return `${ parsedUrl.pathname }${ parsedUrl.search }${ parsedUrl.hash }`;
	} catch {
		return null;
	}
}

// The three surfaces the preview can show: the site itself, WP Admin, and
// the database (phpMyAdmin). Every path belongs to exactly one realm; the
// address bar renders one segment per realm.
export type PreviewRealm = 'frontend' | 'admin' | 'database';

// The phpMyAdmin landing the database segment opens by default: straight to
// the WordPress database.
export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

// A deliberately nonexistent front-end path, offering a way to preview the
// theme's 404 template.
const FRONT_END_NOT_FOUND_PATH = '/this-page-does-not-exist';

/**
 * Which realm a preview path shows. Auto-login hops classify as their
 * redirect target so the active segment doesn't flicker to "front end"
 * while the login redirect is in flight.
 */
export function getPreviewRealm( path: string ): PreviewRealm {
	let target = path;
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const query = path.split( '?' )[ 1 ] ?? '';
		target = new URLSearchParams( query ).get( 'redirect_to' ) ?? '';
	}
	if ( target.includes( '/wp-admin' ) ) {
		return 'admin';
	}
	if ( target.includes( '/phpmyadmin' ) ) {
		return 'database';
	}
	return 'frontend';
}

/**
 * Routes a wp-admin path through the site's `/studio-auto-login` endpoint so
 * it never lands on the login form. Non-admin paths pass through untouched.
 */
export function getRealmNavigationPath( path: string, siteUrl: string ): string {
	if ( ! path.startsWith( '/wp-admin' ) ) {
		return path;
	}
	try {
		const redirectTo = new URL( path, siteUrl ).toString();
		return `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }`;
	} catch {
		return path;
	}
}

// The element type `Icon` accepts (React 19 defaults ReactElement props to
// `unknown`, which it rejects).
type IconElement = ReactElement< SVGProps< SVGSVGElement > >;

// One row in the destinations menu: a front-end page or a WordPress surface.
interface AddressItem {
	id: string;
	icon: IconElement;
	title: string;
	path: string;
}

// Primary-modifier number shortcuts for the realm segments (⌘1/⌘2/⌘3 on
// macOS, Ctrl elsewhere). The host document listener lives in SitePreview.
export const REALM_SHORTCUT_KEYS: Record< PreviewRealm, string > = {
	frontend: '1',
	admin: '2',
	database: '3',
};

// The active frontend segment wears the site's name instead of a static
// title (resolved in the render), like a browser tab for the site itself.
const REALM_SEGMENTS: {
	realm: PreviewRealm;
	icon: IconElement;
	title: string | null;
	label: string;
}[] = [
	{ realm: 'frontend', icon: globe, title: null, label: __( 'View site front end' ) },
	{ realm: 'admin', icon: wordpress, title: __( 'WordPress' ), label: __( 'View WP Admin' ) },
	{ realm: 'database', icon: databaseIcon, title: __( 'Database' ), label: __( 'View database' ) },
];

// Front-end destinations: the home page and a 404 preview.
const FRONTEND_ITEMS: AddressItem[] = [
	{ id: 'home', icon: home, title: __( 'Home' ), path: '/' },
	{ id: 'not-found', icon: help, title: __( '404 page' ), path: FRONT_END_NOT_FOUND_PATH },
];

// The site editor renamed its route slugs alongside the `path`→`p` param
// rename (`/wp_template` became `/template`, and so on); fold each family
// into one canonical route so destinations match on every WP version.
const SITE_EDITOR_ROUTE_ALIASES: Record< string, string > = {
	'/wp_template': '/template',
	'/wp_template_part': '/pattern',
	'/patterns': '/pattern',
	'/wp_global_styles': '/styles',
	'/wp_navigation': '/navigation',
};

function canonicalSiteEditorRoute( value: string ): string {
	return SITE_EDITOR_ROUTE_ALIASES[ value ] ?? value;
}

/**
 * How well a destination matches the preview's current path: -1 for no
 * match, otherwise the number of query params the destination pins down —
 * more params is more specific, so Pages beats Posts on their shared
 * edit.php pathname. WP Admin rewrites its URLs after navigation (the site
 * editor renamed its `path` param to `p`, renamed the route slugs, and
 * appends extras like `canvas`), so declared params match under either
 * name and canonical route, and extra current params are ignored.
 */
function destinationMatchScore( destinationPath: string, currentPath: string ): number {
	let destination: URL;
	let current: URL;
	try {
		destination = new URL( destinationPath, 'http://preview.invalid' );
		current = new URL( currentPath, 'http://preview.invalid' );
	} catch {
		return -1;
	}
	if ( destination.pathname !== current.pathname ) {
		return -1;
	}
	let score = 0;
	for ( const [ key, value ] of destination.searchParams ) {
		const isRouteParam = key === 'path' || key === 'p';
		const aliases = isRouteParam ? [ 'path', 'p' ] : [ key ];
		const matches = aliases.some( ( alias ) => {
			const currentValue = current.searchParams.get( alias );
			if ( currentValue === null ) {
				return false;
			}
			return isRouteParam
				? canonicalSiteEditorRoute( currentValue ) === canonicalSiteEditorRoute( value )
				: currentValue === value;
		} );
		if ( ! matches ) {
			return -1;
		}
		score += 1;
	}
	return score;
}

interface PreviewAddressBarProps {
	site: SiteDetails;
	siteUrl: string;
	// Current preview path; determines the active segment.
	path: string;
	// The database (phpMyAdmin) segment is optional — hidden when the user
	// turns it off.
	showDatabaseTab: boolean;
	onNavigate: ( path: string ) => void;
	// Called when the user clicks an inactive segment; the host navigates to
	// its remembered path for that realm.
	onSwitchRealm: ( realm: PreviewRealm ) => void;
}

/**
 * Segmented browser-style address control. One segment per realm (front
 * end, WP Admin, database): the active segment wears the realm's name and
 * opens a menu of destinations — front-end pages and WordPress surfaces —
 * while clicking an inactive segment flips the preview to that realm's
 * last visited path.
 */
export function PreviewAddressBar( {
	site,
	siteUrl,
	path,
	showDatabaseTab,
	onNavigate,
	onSwitchRealm,
}: PreviewAddressBarProps ) {
	const realm = getPreviewRealm( path );
	const { customizeLinks, contentLinks } = useCustomizeLinks( site );
	// The database segment is optional; everything else always shows.
	const segments = useMemo(
		() => REALM_SEGMENTS.filter( ( segment ) => segment.realm !== 'database' || showDatabaseTab ),
		[ showDatabaseTab ]
	);

	// The selected-segment fill is a separate element that slides between
	// segments. Its position comes from measuring the active button; the
	// ResizeObserver keeps it honest while the title width animates.
	const segmentsRef = useRef< HTMLDivElement | null >( null );
	const [ indicator, setIndicator ] = useState< { left: number; width: number } | null >( null );
	const measureIndicator = useCallback( () => {
		const active = segmentsRef.current?.querySelector< HTMLElement >(
			'button[data-active="true"]'
		);
		if ( ! active ) {
			return;
		}
		const left = active.offsetLeft;
		const width = active.offsetWidth;
		setIndicator( ( current ) =>
			current && current.left === left && current.width === width ? current : { left, width }
		);
	}, [] );
	useLayoutEffect( measureIndicator, [ measureIndicator, realm, site.name, showDatabaseTab ] );
	useEffect( () => {
		const root = segmentsRef.current;
		if ( ! root || typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( measureIndicator );
		observer.observe( root );
		// Observe the segments themselves (not the indicator, which would
		// feed back) so mid-animation width changes re-anchor the fill.
		root.querySelectorAll( 'button' ).forEach( ( button ) => observer.observe( button ) );
		return () => observer.disconnect();
	}, [ measureIndicator ] );

	// The WordPress destinations — the former "Open WordPress…" menu, folded
	// into the address bar. WP Admin and the database are deliberately absent:
	// their segments sit right next to this menu.
	const wordpressItems = useMemo< AddressItem[] >(
		() =>
			[ ...customizeLinks, ...contentLinks ].map( ( link ) => ( {
				id: link.id,
				icon: link.icon,
				title: link.label,
				path: link.url,
			} ) ),
		[ contentLinks, customizeLinks ]
	);

	const navigateTo = useCallback(
		( nextPath: string ) => {
			onNavigate( getRealmNavigationPath( nextPath, siteUrl ) );
		},
		[ onNavigate, siteUrl ]
	);

	// The destination the preview is currently showing, so the menu answers
	// "where am I" at a glance. Best-scoring match wins: destinations sharing
	// a pathname (Posts and Pages both live on edit.php) resolve to the more
	// specific one.
	const currentDestinationId = useMemo( () => {
		let bestId: string | null = null;
		let bestScore = -1;
		for ( const item of [ ...FRONTEND_ITEMS, ...wordpressItems ] ) {
			const score = destinationMatchScore( item.path, path );
			if ( score > bestScore ) {
				bestScore = score;
				bestId = item.id;
			}
		}
		return bestScore >= 0 ? bestId : null;
	}, [ wordpressItems, path ] );

	const renderItems = ( items: AddressItem[] ) =>
		items.map( ( item ) => {
			const isCurrent = item.id === currentDestinationId;
			return (
				<Menu.Item
					key={ item.id }
					className={ isCurrent ? styles.itemCurrent : undefined }
					aria-current={ isCurrent ? 'page' : undefined }
					onClick={ () => navigateTo( item.path ) }
				>
					<span className={ styles.itemIcon } aria-hidden="true">
						<Icon icon={ item.icon } size={ 16 } />
					</span>
					<span className={ styles.itemTitle }>{ item.title }</span>
					<span className={ styles.itemPath }>{ item.path }</span>
				</Menu.Item>
			);
		} );

	return (
		<Menu.Root>
			<div
				ref={ segmentsRef }
				className={ styles.segments }
				role="group"
				aria-label={ __( 'Address' ) }
			>
				<span
					className={ styles.indicator }
					aria-hidden="true"
					style={
						indicator
							? { transform: `translateX(${ indicator.left }px)`, width: indicator.width }
							: { opacity: 0 }
					}
				/>
				{ segments.map( ( segment ) => {
					const isActive = segment.realm === realm;
					const content = (
						<>
							<span className={ styles.segmentIcon } aria-hidden="true">
								<Icon icon={ segment.icon } size={ 16 } />
							</span>
							<span className={ styles.segmentTitle }>{ segment.title ?? site.name }</span>
						</>
					);
					// Both states share one tooltip (label + shortcut) so hovering a
					// segment reads the same whether or not it is selected.
					const tooltip = `${ segment.label } ${ displayShortcut.primary(
						REALM_SHORTCUT_KEYS[ segment.realm ]
					) }`;
					const button = (
						<button
							type="button"
							className={ styles.segment }
							data-active={ isActive || undefined }
							aria-label={ isActive ? undefined : segment.label }
							aria-keyshortcuts={ ariaKeyShortcut.primary( REALM_SHORTCUT_KEYS[ segment.realm ] ) }
							onClick={ isActive ? undefined : () => onSwitchRealm( segment.realm ) }
						/>
					);
					return (
						<Tooltip.Root key={ segment.realm }>
							<Tooltip.Trigger render={ isActive ? <Menu.Trigger render={ button } /> : button }>
								{ content }
							</Tooltip.Trigger>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
								{ tooltip }
							</Tooltip.Popup>
						</Tooltip.Root>
					);
				} ) }
			</div>
			<Menu.Popup side="bottom" align="center" className={ styles.menuPopup }>
				<div className={ styles.groupLabel }>{ __( 'Front end' ) }</div>
				{ renderItems( FRONTEND_ITEMS ) }
				<div className={ styles.groupLabel }>{ __( 'WordPress' ) }</div>
				{ renderItems( wordpressItems ) }
			</Menu.Popup>
		</Menu.Root>
	);
}
