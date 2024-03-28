const ProgressBar = ( { value, maxValue }: { value: number; maxValue: number } ) => {
	// Calculate width percentage of the filled part
	const fillPercentage = Math.max( 0, Math.min( 100, ( value / maxValue ) * 100 ) );

	return (
		<div className="w-full flex h-1 self-stretch rounded-[4.5px] bg-a8c-gray-5">
			<div
				className="h-full bg-a8c-blueberry rounded-[4.5px] transition-all"
				style={ {
					width: `${ fillPercentage }%`,
				} }
			></div>
		</div>
	);
};

export default ProgressBar;
