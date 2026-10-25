import { useEffect, useRef, type ReactNode } from 'react';
import { useStoredFlag } from '@/lib/hooks';
import { CollapsiblePanel, SidebarGroup, SidebarGroupHeader, SidebarGroupLabel } from '@/lib/ui';

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
	children,
}: {
	id: string;
	title: string;
	action?: ReactNode;
	itemKeys?: string[];
	foldable?: boolean;
	children: ReactNode;
} ) {
	const [ storedExpanded, setExpanded ] = useStoredFlag( `studio-ui-sidebar-group-${ id }`, true );
	const expanded = storedExpanded || ! foldable;
	useOpenOnAddedItems( itemKeys, expanded, () => setExpanded( true ) );
	return (
		<SidebarGroup role="group" aria-label={ title } open={ foldable && expanded }>
			<SidebarGroupHeader>
				<SidebarGroupLabel
					expanded={ foldable ? expanded : undefined }
					onExpandedChange={ setExpanded }
				>
					{ title }
				</SidebarGroupLabel>
				{ action }
			</SidebarGroupHeader>
			<CollapsiblePanel open={ expanded }>{ children }</CollapsiblePanel>
		</SidebarGroup>
	);
}
