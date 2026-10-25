import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useStoredFlag } from '@/lib/hooks';
import { CollapsiblePanel } from '@/lib/ui';
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

export function SidebarGroup( {
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
		<div
			role="group"
			className={ styles.group }
			aria-label={ title }
			data-open={ ( foldable && expanded ) || undefined }
		>
			<div className={ styles.groupHeader }>
				{ foldable ? (
					<button
						type="button"
						className={ styles.groupToggle }
						aria-expanded={ expanded }
						onClick={ () => setExpanded( ! expanded ) }
					>
						{ title }
						<ChevronRightIcon className={ styles.groupChevron } />
					</button>
				) : (
					<span className={ styles.groupToggle }>{ title }</span>
				) }
				{ action }
			</div>
			<CollapsiblePanel open={ expanded }>{ children }</CollapsiblePanel>
		</div>
	);
}
