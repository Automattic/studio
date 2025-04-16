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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ value ] );

	useEffect( () => {
		const maximumAutoIncrementValue = maxValue * 0.95;

		const interval = setInterval( () => {
			if ( animatedValue < maximumAutoIncrementValue ) {
				setAnimatedValue( animatedValue + increment );
			}
		}, 1000 );

		return () => {
			clearInterval( interval );
		};
	}, [ animatedValue, maxValue, increment ] );

	return <ProgressBar value={ animatedValue } maxValue={ maxValue } />;
}
