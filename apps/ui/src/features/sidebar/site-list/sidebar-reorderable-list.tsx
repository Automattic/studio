import { ReorderableList, type ReorderableListProps } from '@/lib/ui';
import { useIsSelecting } from './selection';
import styles from './style.module.css';

// Rows hold still while several are selected, so a drag can't scatter them.
export function SidebarReorderableList< T >(
	props: Pick<
		ReorderableListProps< T >,
		'items' | 'getItemId' | 'getItemLabel' | 'renderItem' | 'onReorder' | 'onDragStart' | 'children'
	>
) {
	return (
		<ReorderableList
			{ ...props }
			itemClassName={ styles.dragWrapper }
			excludeSelector="[data-reorder-exclude]"
			disabled={ useIsSelecting() }
		/>
	);
}
