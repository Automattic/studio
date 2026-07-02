import { Autocomplete } from '@base-ui/react/autocomplete';
import { __ } from '@wordpress/i18n';
import { page as pageIcon, post as postIcon } from '@wordpress/icons';
import { privateApis } from '@wordpress/theme';
import { Icon, Tooltip } from '@wordpress/ui';
import { useCallback, useEffect, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useSiteSearch } from '@/data/queries/use-site-search';
import { unlock } from '@/lock-unlock';
import styles from './location-omnibox.module.css';
import type { SiteSearchResult } from '@/data/queries/use-site-search';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

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

interface LocationOmniboxProps {
	siteId: string;
	siteUrl: string;
	// Current preview path, used to prefill the input on open.
	path: string;
	// Full preview URL, shown in the trigger tooltip.
	previewUrl: string;
	pageTitle: string;
	// Content search needs the site REST API, which is unavailable in the
	// non-Electron iframe fallback; plain path navigation still works there.
	searchEnabled: boolean;
	// The popup anchors to this element (the toolbar's location slot) so it
	// opens wide and centered like a browser address bar.
	anchorRef: RefObject< HTMLElement | null >;
	onNavigate: ( path: string ) => void;
}

/**
 * Browser-style address control: the page title doubles as a button that
 * opens a popover where the user can type a path/URL to navigate the
 * preview, or search the site's pages and posts and jump to one.
 */
export function LocationOmnibox( {
	siteId,
	siteUrl,
	path,
	previewUrl,
	pageTitle,
	searchEnabled,
	anchorRef,
	onNavigate,
}: LocationOmniboxProps ) {
	const [ open, setOpen ] = useState( false );
	const [ inputValue, setInputValue ] = useState( '' );
	const [ highlightedItem, setHighlightedItem ] = useState< SiteSearchResult | undefined >(
		undefined
	);

	const intent = parseOmniboxInput( inputValue, siteUrl );
	const searchTerm = intent?.type === 'search' ? intent.term : '';
	const debouncedTerm = useDebouncedValue( searchTerm, 250 );
	const search = useSiteSearch( siteId, debouncedTerm, searchEnabled && open );
	// Typed paths suppress the list entirely so Enter always navigates the
	// path instead of a stale highlighted result.
	const items = searchTerm && debouncedTerm ? search.data ?? [] : [];

	const navigateTo = useCallback(
		( nextPath: string ) => {
			onNavigate( nextPath );
			setOpen( false );
		},
		[ onNavigate ]
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
		if ( highlightedItem && items.length > 0 ) {
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

	const showsSearchUi = searchEnabled && intent?.type === 'search';
	const isSearching =
		showsSearchUi && items.length === 0 && ( search.isFetching || debouncedTerm !== searchTerm );
	const status = ! showsSearchUi
		? null
		: search.isError
		? __( 'Search unavailable' )
		: isSearching
		? __( 'Searching…' )
		: items.length === 0 && debouncedTerm
		? __( 'No matches' )
		: null;

	return (
		<Autocomplete.Root
			items={ items }
			mode="none"
			autoHighlight
			value={ inputValue }
			onValueChange={ setInputValue }
			open={ open }
			onOpenChange={ handleOpenChange }
			onItemHighlighted={ setHighlightedItem }
			itemToStringValue={ ( item: SiteSearchResult ) => item.path }
		>
			<Tooltip.Root>
				<Autocomplete.Trigger
					render={
						<Tooltip.Trigger render={ <button type="button" className={ styles.trigger } /> }>
							{ pageTitle }
						</Tooltip.Trigger>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
					{ previewUrl }
				</Tooltip.Popup>
			</Tooltip.Root>
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
							{ items.length > 0 ? (
								<Autocomplete.List className={ styles.list }>
									{ ( item: SiteSearchResult ) => (
										<Autocomplete.Item
											key={ item.id }
											value={ item }
											className={ styles.item }
											onClick={ () => navigateTo( item.path ) }
										>
											<span className={ styles.itemIcon } aria-hidden="true">
												<Icon icon={ item.subtype === 'page' ? pageIcon : postIcon } size={ 16 } />
											</span>
											<span className={ styles.itemTitle }>{ item.title }</span>
											<span className={ styles.itemPath }>{ item.path }</span>
										</Autocomplete.Item>
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
