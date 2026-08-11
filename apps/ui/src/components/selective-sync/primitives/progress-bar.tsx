import { ProgressBar as WPProgressBar } from '@wordpress/components';
import { useEffect, useState } from 'react';
import { cx } from '@/components/selective-sync/lib/cx';

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
	normalColorClass?: string;
	overLimitColorClass?: string;
	trackColorClass?: string;
	showLabels?: boolean;
	valueLabel?: string;
	limitLabel?: string;
	overLimitLabel?: string;
};

export function TwoColorProgressBar( {
	value,
	maxValue,
	normalColorClass = 'bg-frame-theme',
	overLimitColorClass = 'bg-a8c-red-50',
	trackColorClass = 'bg-frame-text-secondary',
	showLabels = false,
	valueLabel,
	limitLabel,
	overLimitLabel,
}: TwoColorProgressBarProps ) {
	const isOverLimit = value > maxValue;
	const percentage = Math.min( ( value / maxValue ) * 100, 100 );

	return (
		<div>
			{ showLabels && ( valueLabel || limitLabel || overLimitLabel ) && (
				<div className="flex justify-between items-center text-xs mb-2">
					<div className="text-frame-text font-medium uppercase">{ valueLabel }</div>
					<div>
						{ isOverLimit && overLimitLabel ? (
							<span className="text-frame-text-secondary text-xs">{ overLimitLabel }</span>
						) : (
							limitLabel && (
								<span className="text-frame-text-secondary text-xs">{ limitLabel }</span>
							)
						) }
					</div>
				</div>
			) }
			<div
				className={ cx(
					'relative w-full h-[1.5px] rounded-full overflow-hidden',
					trackColorClass
				) }
			>
				{ isOverLimit ? (
					<>
						<div
							className={ cx(
								'absolute left-0 top-0 h-full transition-all duration-300',
								normalColorClass
							) }
							style={ { width: `${ ( maxValue / value ) * 100 }%` } }
						/>
						<div
							className={ cx(
								'absolute top-0 h-full transition-all duration-300',
								overLimitColorClass
							) }
							style={ {
								left: `${ ( maxValue / value ) * 100 }%`,
								width: `${ ( ( value - maxValue ) / value ) * 100 }%`,
							} }
						/>
					</>
				) : (
					<div
						className={ cx(
							'absolute left-0 top-0 h-full rounded-full transition-all duration-300',
							normalColorClass
						) }
						style={ { width: `${ percentage }%` } }
					/>
				) }
			</div>
		</div>
	);
}
