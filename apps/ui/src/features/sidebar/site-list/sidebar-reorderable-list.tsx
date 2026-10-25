import { ReorderableList, type ReorderableListProps } from '@/features/sidebar/reorderable-list';
import { useIsSelecting } from './selection';
import styles from './style.module.css';

// Rows hold still while several are selected, so a drag can't scatter them.
export function SidebarReorderableList< T >(
	props: Pick<
		ReorderableListProps< T >,
		'items' | 'getItemId' | 'getItemLabel' | 'renderItem' | 'onReorder'
	>
) {
	return (
		<ReorderableList
			{ ...props }
			className={ styles.sites }
			itemClassName={ styles.siteDragWrapper }
			previewClassName={ styles.siteDragPreview }
			excludeSelector="[data-reorder-exclude]"
			disabled={ useIsSelecting() }
		/>
	);
}
