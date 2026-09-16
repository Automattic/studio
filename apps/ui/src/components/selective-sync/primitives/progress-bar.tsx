import { cx } from '@/components/selective-sync/lib/cx';

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
