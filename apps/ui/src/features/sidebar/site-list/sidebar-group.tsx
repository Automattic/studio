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
	const expanded = storedExpanded || ! foldable;
	useOpenOnAddedItems( itemKeys, expanded, () => setExpanded( true ) );
	if ( hidden ) {
		return null;
	}
	return (
		<SidebarGroup role="group" aria-label={ title } open={ foldable && expanded }>
			<SidebarGroupHeader>
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
