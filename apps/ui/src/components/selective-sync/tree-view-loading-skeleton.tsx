import { cx } from '@/components/selective-sync/lib/cx';
import styles from './tree-view-loading-skeleton.module.css';

export const TreeViewLoadingSkeleton = () => {
	return (
		<div className="mt-2 space-y-4">
			{ [ 1, 2 ].map( ( key ) => (
				<div key={ key } className="py-2">
					<div className="flex items-center gap-3">
						<div className={ cx( 'w-5 h-5 rounded', styles.placeholder ) } />
						<div className={ cx( 'h-5 w-36 rounded', styles.placeholder ) } />
					</div>
				</div>
			) ) }
		</div>
	);
};
