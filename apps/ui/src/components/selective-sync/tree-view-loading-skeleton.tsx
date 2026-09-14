export const TreeViewLoadingSkeleton = () => {
	return (
		<div className="mt-2 space-y-4">
			{ [ 1, 2 ].map( ( key ) => (
				<div key={ key } className="py-2">
					<div className="flex items-center gap-3">
						<div className="w-5 h-5 rounded skeleton-bg" />
						<div className="h-5 w-36 rounded skeleton-bg" />
					</div>
				</div>
			) ) }
		</div>
	);
};
