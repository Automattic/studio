import { useEffect, useState } from 'react';

const ProgressBar = ( {
	value,
	maxValue,
}: {
	value: number;
	maxValue: number;
	autoProgress?: boolean;
} ) => {
	// Calculate width percentage of the filled part
	const fillPercentage = Math.max( 0, Math.min( 100, ( value / maxValue ) * 100 ) );

	return (
		<div className="w-full flex h-1 self-stretch rounded-[4.5px] bg-a8c-gray-5">
			<div
				role="progressbar"
				aria-valuenow={ fillPercentage }
				className="h-full bg-a8c-blueberry rounded-[4.5px] transition-all"
				style={ {
					width: `${ fillPercentage }%`,
				} }
			></div>
		</div>
	);
};

export default ProgressBar;

export function ProgressBarWithAutoIncrement( {
	maxValue,
	initialValue,
	increment = 2,
}: {
	maxValue: number;
	initialValue: number;
	increment?: number;
} ) {
	const [ value, setValue ] = useState( initialValue );

	useEffect( () => {
		const interval = setInterval( () => {
			if ( value < maxValue ) {
				setValue( value + increment );
			}
		}, 1000 );

		return () => clearInterval( interval );
	}, [ value, maxValue, increment ] );

	return <ProgressBar value={ value } maxValue={ maxValue } />;
}
