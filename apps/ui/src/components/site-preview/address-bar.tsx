import { Autocomplete } from '@base-ui/react/autocomplete';
import { __ } from '@wordpress/i18n';
import { globe, help, home, page as pageIcon, post as postIcon, wordpress } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut } from '@wordpress/keycodes';
import { privateApis } from '@wordpress/theme';
import { Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useSiteFrontLinks } from '@/data/queries/use-site-front-links';
import { useSiteSearch } from '@/data/queries/use-site-search';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { databaseIcon } from '@/lib/icons';
import { unlock } from '@/lock-unlock';
import styles from './address-bar.module.css';
import type { SiteDetails } from '@/data/core';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, RefObject, SVGProps } from 'react';

const { ThemeProvider } = unlock( privateApis );

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

export type OmniboxIntent = { type: 'path'; path: string } | { type: 'search'; term: string };

/**
 * Classifies what the user typed into the omnibox: something navigable (a
 * same-origin URL or a path) or a term to search the site's content for.
 * Cross-origin URLs return null — they can't be shown in the preview.
 */
export function parseOmniboxInput( raw: string, siteUrl: string ): OmniboxIntent | null {
	const value = raw.trim();
	if ( ! value ) {
		return null;
	}
	if ( /^https?:\/\//i.test( value ) ) {
		const path = getPathFromPreviewUrl( value, siteUrl );
		return path ? { type: 'path', path } : null;
	}
	if ( /\s/.test( value ) ) {
		return { type: 'search', term: value };
	}
	if ( value.startsWith( '/' ) ) {
		return { type: 'path', path: value };
	}
	if ( value.includes( '/' ) || value.includes( '?' ) ) {
		return { type: 'path', path: `/${ value }` };
	}
	return { type: 'search', term: value };
}

function useDebouncedValue< T >( value: T, delayMs: number ): T {
	const [ debounced, setDebounced ] = useState( value );
	useEffect( () => {
		const timer = setTimeout( () => setDebounced( value ), delayMs );
		return () => clearTimeout( timer );
	}, [ value, delayMs ] );
	return debounced;
}

// The element type `Icon` accepts (React 19 defaults ReactElement props to
// `unknown`, which it rejects).
type IconElement = ReactElement< SVGProps< SVGSVGElement > >;

// One row in the popover list: a WordPress destination (admin surface or the
// database) or a content match from the site search.
interface AddressItem {
	kind: 'destination' | 'content';
	id: string;
	icon: IconElement;
	title: string;
	path: string;
}

// A labeled group of address items for the dropdown (e.g. "Front end",
// "WordPress"). An empty label renders the rows without a heading. The `items`
// shape is what Base UI keys grouped rendering off (see `Autocomplete.Group`).
interface AddressGroup {
	value: string;
	items: AddressItem[];
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
	// Current preview path; determines the active segment and prefills the
	// input on open.
	path: string;
	// Content search needs the site REST API, which is unavailable in the
	// non-Electron iframe fallback; plain path navigation still works there.
	searchEnabled: boolean;
	// The popup anchors to this element (the toolbar's location slot) so it
	// opens wide and centered like a browser address bar.
	anchorRef: RefObject< HTMLElement | null >;
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
 * opens an omnibox popover showing the current path — type a path, search
 * pages and posts, or pick a WordPress destination — while clicking an
 * inactive segment flips the preview to that realm's last visited path.
 */
export function PreviewAddressBar( {
	site,
	siteUrl,
	path,
	searchEnabled,
	anchorRef,
	showDatabaseTab,
	onNavigate,
	onSwitchRealm,
}: PreviewAddressBarProps ) {
	const [ open, setOpen ] = useState( false );
	const [ inputValue, setInputValue ] = useState( '' );
	const [ highlightedItem, setHighlightedItem ] = useState< AddressItem | undefined >( undefined );
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
	// their segments sit right next to the omnibox.
	const wordpressItems = useMemo< AddressItem[] >(
		() =>
			[ ...customizeLinks, ...contentLinks ].map( ( link ) => ( {
				kind: 'destination' as const,
				id: link.id,
				icon: link.icon,
				title: link.label,
				path: link.url,
			} ) ),
		[ contentLinks, customizeLinks ]
	);

	const intent = parseOmniboxInput( inputValue, siteUrl );
	const searchTerm = intent?.type === 'search' ? intent.term : '';
	const debouncedTerm = useDebouncedValue( searchTerm, 250 );
	const search = useSiteSearch( site.id, debouncedTerm, searchEnabled && open );
	// Real front-end permalinks (latest post + a page) for the zero state; only
	// worth fetching while the popup is open and the REST transport is available.
	const frontLinks = useSiteFrontLinks( site.id, searchEnabled && open );

	// Front-end destinations: the home page and a 404 preview always, plus the
	// latest post and a page once their permalinks resolve.
	const frontendItems = useMemo< AddressItem[] >( () => {
		const items: AddressItem[] = [
			{ kind: 'destination', id: 'home', icon: home, title: __( 'Home' ), path: '/' },
			{
				kind: 'destination',
				id: 'not-found',
				icon: help,
				title: __( '404 page' ),
				path: FRONT_END_NOT_FOUND_PATH,
			},
		];
		if ( frontLinks.data?.post ) {
			items.push( {
				kind: 'destination',
				id: 'latest-post',
				icon: postIcon,
				title: frontLinks.data.post.title,
				path: frontLinks.data.post.path,
			} );
		}
		if ( frontLinks.data?.page ) {
			items.push( {
				kind: 'destination',
				id: 'published-page',
				icon: pageIcon,
				title: frontLinks.data.page.title,
				path: frontLinks.data.page.path,
			} );
		}
		return items;
	}, [ frontLinks.data ] );

	// The destination the preview is currently showing, so the zero state
	// answers "where am I" at a glance. Best-scoring match wins: destinations
	// sharing a pathname (Posts and Pages both live on edit.php) resolve to
	// the more specific one.
	const currentDestinationId = useMemo( () => {
		let bestId: string | null = null;
		let bestScore = -1;
		for ( const item of [ ...frontendItems, ...wordpressItems ] ) {
			const score = destinationMatchScore( item.path, path );
			if ( score > bestScore ) {
				bestScore = score;
				bestId = item.id;
			}
		}
		return bestScore >= 0 ? bestId : null;
	}, [ frontendItems, wordpressItems, path ] );

	// Untouched (prefilled) or cleared input rests on the grouped destinations
	// (Front end / WordPress); search terms blend destination matches with
	// content results into a single unlabeled group; typed paths suppress the
	// list entirely so Enter always navigates the path instead of a stale
	// highlighted result.
	const isZeroState = ! inputValue.trim() || inputValue === path;
	const groups = useMemo< AddressGroup[] >( () => {
		if ( isZeroState ) {
			return [
				{ value: __( 'Front end' ), items: frontendItems },
				{ value: __( 'WordPress' ), items: wordpressItems },
			].filter( ( group ) => group.items.length > 0 );
		}
		if ( ! searchTerm ) {
			return [];
		}
		const term = searchTerm.toLowerCase();
		const destinationMatches = [ ...frontendItems, ...wordpressItems ].filter( ( destination ) =>
			destination.title.toLowerCase().includes( term )
		);
		const contentMatches = debouncedTerm
			? ( search.data ?? [] ).map( ( result ) => ( {
					kind: 'content' as const,
					id: `content-${ result.id }`,
					icon: result.subtype === 'page' ? pageIcon : postIcon,
					title: result.title,
					path: result.path,
			  } ) )
			: [];
		const matches = [ ...destinationMatches, ...contentMatches ];
		return matches.length > 0 ? [ { value: '', items: matches } ] : [];
	}, [ isZeroState, frontendItems, wordpressItems, searchTerm, debouncedTerm, search.data ] );
	const flatItems = useMemo( () => groups.flatMap( ( group ) => group.items ), [ groups ] );

	const navigateTo = useCallback(
		( nextPath: string ) => {
			onNavigate( getRealmNavigationPath( nextPath, siteUrl ) );
			setOpen( false );
		},
		[ onNavigate, siteUrl ]
	);

	// Prefill with the current path and select it, like a browser address bar
	// (the selection happens in the input's mount ref below).
	const handleOpenChange = ( nextOpen: boolean ) => {
		if ( nextOpen ) {
			setInputValue( path );
			setHighlightedItem( undefined );
		}
		setOpen( nextOpen );
	};

	// The popup (and input) unmount when closed, so this runs once per open.
	const selectOnMount = useCallback( ( input: HTMLInputElement | null ) => {
		input?.select();
	}, [] );

	const handleInputKeyDown = ( event: ReactKeyboardEvent< HTMLInputElement > ) => {
		if ( event.key !== 'Enter' ) {
			return;
		}
		if ( highlightedItem && flatItems.length > 0 ) {
			event.preventDefault();
			navigateTo( highlightedItem.path );
			return;
		}
		if ( ! intent ) {
			return;
		}
		event.preventDefault();
		if ( intent.type === 'path' ) {
			navigateTo( intent.path );
			return;
		}
		// No result to pick — fall through to the site's own search page.
		navigateTo( `/?s=${ encodeURIComponent( intent.term ) }` );
	};

	const showsSearchUi = searchEnabled && ! isZeroState && intent?.type === 'search';
	const isSearching =
		showsSearchUi &&
		flatItems.length === 0 &&
		( search.isFetching || debouncedTerm !== searchTerm );
	const status = ! showsSearchUi
		? null
		: search.isError
		? __( 'Search unavailable' )
		: isSearching
		? __( 'Searching…' )
		: flatItems.length === 0 && debouncedTerm
		? __( 'No matches' )
		: null;

	return (
		<Autocomplete.Root
			items={ groups }
			mode="none"
			// In the zero state Enter should re-navigate the prefilled path,
			// not the first destination — highlight only follows typing.
			autoHighlight={ ! isZeroState }
			value={ inputValue }
			onValueChange={ setInputValue }
			open={ open }
			onOpenChange={ handleOpenChange }
			onItemHighlighted={ setHighlightedItem }
			itemToStringValue={ ( item: AddressItem ) => item.path }
		>
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
							<Tooltip.Trigger
								render={ isActive ? <Autocomplete.Trigger render={ button } /> : button }
							>
								{ content }
							</Tooltip.Trigger>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
								{ tooltip }
							</Tooltip.Popup>
						</Tooltip.Root>
					);
				} ) }
			</div>
			<Autocomplete.Portal>
				<Autocomplete.Positioner
					anchor={ anchorRef }
					side="bottom"
					align="center"
					sideOffset={ 4 }
					className={ styles.positioner }
				>
					{ /* Portals mount into document.body, escaping the app-root
						ThemeProvider's density wrapper — re-establish it so icons
						inside the popup render at their normal size (same fix as
						the shared menu component). */ }
					<ThemeProvider density="compact">
						<Autocomplete.Popup className={ `${ styles.popup } ${ motionStyles.motion }` }>
							<Autocomplete.Input
								ref={ selectOnMount }
								className={ styles.input }
								placeholder={
									searchEnabled
										? __( 'Type a path, or search pages and posts' )
										: __( 'Type a path' )
								}
								aria-label={ __( 'Address and search' ) }
								onKeyDown={ handleInputKeyDown }
							/>
							{ groups.length > 0 ? (
								<Autocomplete.List className={ styles.list }>
									{ ( group: AddressGroup ) => (
										<Autocomplete.Group
											key={ group.value || 'results' }
											items={ group.items }
											className={ styles.group }
										>
											{ group.value ? (
												<Autocomplete.GroupLabel className={ styles.groupLabel }>
													{ group.value }
												</Autocomplete.GroupLabel>
											) : null }
											<Autocomplete.Collection>
												{ ( item: AddressItem ) => (
													<Autocomplete.Item
														key={ item.id }
														value={ item }
														className={ clsx(
															styles.item,
															item.id === currentDestinationId && styles.itemCurrent
														) }
														aria-current={ item.id === currentDestinationId ? 'page' : undefined }
														onClick={ () => navigateTo( item.path ) }
													>
														<span
															className={ clsx(
																styles.itemIcon,
																item.kind === 'destination' && styles.itemIconDestination
															) }
															aria-hidden="true"
														>
															<Icon icon={ item.icon } size={ 16 } />
														</span>
														<span className={ styles.itemTitle }>{ item.title }</span>
														<span className={ styles.itemPath }>{ item.path }</span>
													</Autocomplete.Item>
												) }
											</Autocomplete.Collection>
										</Autocomplete.Group>
									) }
								</Autocomplete.List>
							) : null }
							{ status ? (
								<div className={ styles.status } role="status">
									{ status }
								</div>
							) : null }
						</Autocomplete.Popup>
					</ThemeProvider>
				</Autocomplete.Positioner>
			</Autocomplete.Portal>
		</Autocomplete.Root>
	);
}
