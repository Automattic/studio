import { cx } from 'src/lib/cx';

export const TreeViewLoadingSkeleton = () => {
	const skeletonBg = 'animate-pulse bg-gradient-to-r from-[#F6F7F7] via-[#DCDCDE] to-[#F6F7F7]';

	return (
		<div className="mt-2 space-y-4">
			{ [ 1, 2 ].map( ( key ) => (
				<div key={ key } className="py-2">
					<div className="flex items-center gap-3">
						<div className={ cx( 'w-5 h-5 rounded', skeletonBg ) } />
						<div className={ cx( 'h-5 w-36 rounded', skeletonBg ) } />
					</div>
				</div>
			) ) }
		</div>
	);
};
