import { useEffect, useState } from 'react';

type ProgressBarProps = {
	value: number;
	maxValue: number;
};

const ProgressBar = ( { value, maxValue }: ProgressBarProps ) => {
	// Calculate width percentage of the filled part
	const fillPercentage = Math.max( 0, Math.min( 100, ( value / maxValue ) * 100 ) );

	return (
		<div className="w-full flex h-0.5 self-stretch rounded-[4.5px] bg-a8c-gray-5">
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

type ProgressBarWithAutoIncrementProps = {
	maxValue: number;
	value: number;
	increment?: number;
};

export function ProgressBarWithAutoIncrement( {
	maxValue,
	value,
	increment = 2,
}: ProgressBarWithAutoIncrementProps ) {
	const [ animatedValue, setAnimatedValue ] = useState( value );

	useEffect( () => {
		if ( value > animatedValue ) {
			setAnimatedValue( value );
		}
		// We only want to run this effect when the `value` prop changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ value ] );

	useEffect( () => {
		const maximumAutoIncrementValue = maxValue * 0.95;

		// This effect reruns every time `animatedValue` changes, so setting a timeout has the same
		// effect as setting an interval.
		const timeoutId = setTimeout( () => {
			if ( animatedValue < maximumAutoIncrementValue ) {
				setAnimatedValue( animatedValue + increment );
			}
		}, 1000 );

		return () => {
			clearTimeout( timeoutId );
		};
	}, [ animatedValue, maxValue, increment ] );

	return <ProgressBar value={ animatedValue } maxValue={ maxValue } />;
}
