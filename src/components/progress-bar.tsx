import { ProgressBar as WPProgressBar } from '@wordpress/components';
import { useEffect, useState } from 'react';
import { cx } from 'src/lib/cx';

type ProgressBarProps = {
	value?: number;
	maxValue?: number;
	className?: string;
};

const ProgressBar = ( { value, maxValue, className }: ProgressBarProps ) => {
	const classNames = cx( '!w-full flex', className );
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

type TwoColorProgressBarProps = {
	value: number;
	maxValue: number;
	normalColor?: string;
	overLimitColor?: string;
	trackColor?: string;
};

export function TwoColorProgressBar( {
	value,
	maxValue,
	normalColor = '#3858E9',
	overLimitColor = '#D63638',
	trackColor = '#E5E7EB',
}: TwoColorProgressBarProps ) {
	const isOverLimit = value > maxValue;
	const percentage = Math.min( ( value / maxValue ) * 100, 100 );

	return (
		<div
			className="relative w-full h-[1.5px] rounded-full overflow-hidden"
			style={ { backgroundColor: trackColor } }
		>
			{ isOverLimit ? (
				<>
					<div
						className="absolute left-0 top-0 h-full transition-all duration-300"
						style={ {
							width: `${ ( maxValue / value ) * 100 }%`,
							backgroundColor: normalColor,
						} }
					/>
					<div
						className="absolute top-0 h-full transition-all duration-300"
						style={ {
							left: `${ ( maxValue / value ) * 100 }%`,
							width: `${ ( ( value - maxValue ) / value ) * 100 }%`,
							backgroundColor: overLimitColor,
						} }
					/>
				</>
			) : (
				<div
					className="absolute left-0 top-0 h-full rounded-full transition-all duration-300"
					style={ {
						width: `${ percentage }%`,
						backgroundColor: normalColor,
					} }
				/>
			) }
		</div>
	);
}
