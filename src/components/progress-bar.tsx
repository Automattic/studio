import { ProgressBar as WPProgressBar } from '@wordpress/components';
import { useEffect, useState } from 'react';
import { cx } from 'src/lib/cx';

type ProgressBarProps = {
	value?: number;
	maxValue?: number;
	className?: string;
};

const ProgressBar = ( { value, maxValue, className }: ProgressBarProps ) => {
	const classNames = cx( 'w-full flex', className );
	if ( value !== undefined && maxValue !== undefined ) {
		const percentage = Math.max( 0, Math.min( 100, ( value / maxValue ) * 100 ) );
		return <WPProgressBar value={ percentage } className={ classNames } />;
	}

	// Otherwise, use indeterminate progress bar
	return <WPProgressBar className={ classNames } />;
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
