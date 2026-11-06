import { useEffect, useRef, type ReactNode } from 'react';
import { useStoredFlag } from '@/lib/hooks';
import { CollapsiblePanel, SidebarGroup, SidebarGroupHeader, SidebarGroupLabel } from '@/lib/ui';
import styles from './style.module.css';

// Opens a collapsed group when something is added to it, e.g. a new site.
// `keys` is undefined until the group's items have loaded.
function useOpenOnAddedItems( keys: string[] | undefined, open: boolean, onOpen: () => void ) {
	const previous = useRef< Set< string > | null >( null );
	useEffect( () => {
		if ( ! keys ) {
			return;
		}
		const known = previous.current;
		previous.current = new Set( keys );
		if ( known && ! open && keys.some( ( key ) => ! known.has( key ) ) ) {
			onOpen();
		}
	}, [ keys, open, onOpen ] );
}

export function SiteListGroup( {
	id,
	title,
	action,
	itemKeys,
	foldable = true,
	hidden = false,
	onFold,
	children,
}: {
	id: string;
	title: string;
	action?: ReactNode;
	itemKeys?: string[];
	foldable?: boolean;
	// An empty group stays mounted, hidden, so its first item still opens it.
	hidden?: boolean;
	onFold?: () => void;
	children: ReactNode;
} ) {
	const [ storedExpanded, setExpanded ] = useStoredFlag( `studio-ui-sidebar-group-${ id }`, true );
	const headerRef = useRef< HTMLDivElement >( null );
	useEffect( () => {
		const header = headerRef.current;
		if ( ! header || typeof IntersectionObserver === 'undefined' ) return;
		let scrollport = header.parentElement;
		while ( scrollport && ! /auto|scroll/.test( getComputedStyle( scrollport ).overflowY ) ) {
			scrollport = scrollport.parentElement;
		}
		const observer = new IntersectionObserver(
			( [ entry ] ) => {
				header.toggleAttribute( 'data-clipped', entry.intersectionRatio < 1 );
			},
			{ root: scrollport, threshold: 1 }
		);
		observer.observe( header );
		return () => observer.disconnect();
	}, [ hidden ] );
	const expanded = storedExpanded || ! foldable;
	useOpenOnAddedItems( itemKeys, expanded, () => setExpanded( true ) );
	if ( hidden ) {
		return null;
	}
	return (
		<SidebarGroup
			className={ styles.group }
			role="group"
			aria-label={ title }
			open={ foldable && expanded }
		>
			<SidebarGroupHeader ref={ headerRef } className={ styles.groupHeader }>
				<SidebarGroupLabel
					expanded={ foldable ? expanded : undefined }
					onExpandedChange={ ( next ) => {
						setExpanded( next );
						if ( ! next ) {
							onFold?.();
						}
					} }
				>
					{ title }
				</SidebarGroupLabel>
				{ action }
			</SidebarGroupHeader>
			<CollapsiblePanel open={ expanded } className={ styles.groupPanel }>
				{ children }
			</CollapsiblePanel>
		</SidebarGroup>
	);
}
