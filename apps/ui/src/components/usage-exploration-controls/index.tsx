import { __ } from '@wordpress/i18n';
import { closeSmall } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
	addExplorationCredits,
	dollarsFromCredits,
	setUsageExplorationMeterStyle,
	setUsageExplorationPurchaseCreditsVariant,
	setUsageExplorationPurchaseCreditsFlow,
	setUsageExplorationMeterIconSize,
	setUsageExplorationRingSize,
	setUsageExplorationRingStrokeWidth,
	setUsageExplorationScenario,
	setUsageExplorationSignalAlignment,
	setUsageExplorationSignalBarCount,
	setUsageExplorationSignalBarThickness,
	setUsageExplorationSignalOrientation,
	setUsageExplorationSignalStackDirection,
	spendExplorationPurchasedCredits,
	useUsageExploration,
	type UsageSignalAlignment,
	type UsageSignalOrientation,
	type UsageSignalStackDirection,
	type UsageMeterStyle,
	type PurchaseCreditsVariant,
	type PurchaseCreditsFlow,
	type UsageExplorationScenario,
} from '@/data/usage-exploration';
import styles from './style.module.css';

const MONTHLY_SCENARIOS: Array< { value: UsageExplorationScenario; label: string } > = [
	{ value: 'fresh', label: '0%' },
	{ value: 'healthy', label: '36%' },
	{ value: 'warning', label: '80%' },
	{ value: 'critical', label: '90%' },
	{ value: 'exhausted', label: '100%' },
];

const PURCHASED_SCENARIOS: Array< { value: UsageExplorationScenario; label: string } > = [
	{ value: 'extra-reserve', label: __( '500K reserve' ) },
	{ value: 'extra-full', label: __( '500K available' ) },
	{ value: 'extra-healthy', label: __( '320K' ) },
	{ value: 'extra-warning', label: __( '100K' ) },
	{ value: 'extra-critical', label: __( '50K' ) },
	{ value: 'extra-exhausted', label: '0' },
];

function ScenarioRow( {
	label,
	options,
	selected,
}: {
	label: string;
	options: Array< { value: UsageExplorationScenario; label: string } >;
	selected: UsageExplorationScenario;
} ) {
	return (
		<div className={ styles.row }>
			<span className={ styles.rowLabel }>{ label }</span>
			<div className={ styles.buttons }>
				{ options.map( ( option ) => (
					<button
						key={ option.value }
						type="button"
						className={ styles.stateButton }
						data-selected={ selected === option.value ? '' : undefined }
						aria-label={ `${ label } ${ option.label }` }
						onClick={ () => setUsageExplorationScenario( option.value ) }
					>
						{ option.label }
					</button>
				) ) }
			</div>
		</div>
	);
}

export function UsageExplorationControls() {
	const {
		scenario,
		meterStyle,
		purchaseCreditsVariant,
		purchaseCreditsFlow,
		signalOrientation,
		signalAlignment,
		signalBarCount,
		signalBarThickness,
		signalStackDirection,
		meterIconSize,
		ringSize,
		ringStrokeWidth,
	} = useUsageExploration();
	const [ visible, setVisible ] = useState( true );
	const [ creditAdjustment, setCreditAdjustment ] = useState( 100_000 );
	const [ position, setPosition ] = useState< { x: number; y: number } | null >( null );
	const panelRef = useRef< HTMLElement | null >( null );
	const dragRef = useRef< {
		pointerId: number;
		startPointerX: number;
		startPointerY: number;
		startPanelX: number;
		startPanelY: number;
	} | null >( null );

	useEffect( () => {
		const toggleControls = ( event: KeyboardEvent ) => {
			if (
				( event.metaKey || event.ctrlKey ) &&
				event.shiftKey &&
				event.key.toLowerCase() === 'u'
			) {
				event.preventDefault();
				setVisible( ( current ) => ! current );
			}
		};
		window.addEventListener( 'keydown', toggleControls );
		return () => window.removeEventListener( 'keydown', toggleControls );
	}, [] );

	if ( ! visible ) {
		return null;
	}

	const handlePointerDown = ( event: PointerEvent< HTMLDivElement > ) => {
		if ( event.button !== 0 || ( event.target as Element ).closest( 'button' ) ) {
			return;
		}
		const panel = panelRef.current;
		if ( ! panel ) {
			return;
		}
		const rect = panel.getBoundingClientRect();
		dragRef.current = {
			pointerId: event.pointerId,
			startPointerX: event.clientX,
			startPointerY: event.clientY,
			startPanelX: rect.left,
			startPanelY: rect.top,
		};
		event.currentTarget.setPointerCapture( event.pointerId );
	};

	const handlePointerMove = ( event: PointerEvent< HTMLDivElement > ) => {
		const drag = dragRef.current;
		const panel = panelRef.current;
		if ( ! drag || drag.pointerId !== event.pointerId || ! panel ) {
			return;
		}
		const maxX = Math.max( 0, window.innerWidth - panel.offsetWidth );
		const maxY = Math.max( 0, window.innerHeight - panel.offsetHeight );
		setPosition( {
			x: Math.min( maxX, Math.max( 0, drag.startPanelX + event.clientX - drag.startPointerX ) ),
			y: Math.min( maxY, Math.max( 0, drag.startPanelY + event.clientY - drag.startPointerY ) ),
		} );
	};

	const handlePointerUp = ( event: PointerEvent< HTMLDivElement > ) => {
		if ( dragRef.current?.pointerId === event.pointerId ) {
			dragRef.current = null;
			event.currentTarget.releasePointerCapture( event.pointerId );
		}
	};

	const positionStyle: CSSProperties | undefined = position
		? { left: position.x, top: position.y, bottom: 'auto', transform: 'none' }
		: undefined;

	return (
		<aside
			ref={ panelRef }
			className={ styles.root }
			style={ positionStyle }
			aria-label={ __( 'Usage prototype controls' ) }
		>
			<div
				className={ styles.header }
				onPointerDown={ handlePointerDown }
				onPointerMove={ handlePointerMove }
				onPointerUp={ handlePointerUp }
				onPointerCancel={ handlePointerUp }
			>
				<strong>{ __( 'Usage prototype' ) }</strong>
				<IconButton
					icon={ closeSmall }
					label={ __( 'Hide prototype controls. Press Command-Shift-U to show them again.' ) }
					size="small"
					variant="minimal"
					tone="neutral"
					onClick={ () => setVisible( false ) }
				/>
			</div>
			<ScenarioRow label={ __( 'Monthly' ) } options={ MONTHLY_SCENARIOS } selected={ scenario } />
			<div className={ styles.row }>
				<span className={ styles.rowLabel }>{ __( 'Meter' ) }</span>
				<div className={ styles.buttons }>
					{ ( [ 'ring', 'signal' ] as UsageMeterStyle[] ).map( ( option ) => (
						<button
							key={ option }
							type="button"
							className={ styles.stateButton }
							data-selected={ meterStyle === option ? '' : undefined }
							onClick={ () => setUsageExplorationMeterStyle( option ) }
						>
							{ option === 'ring' ? __( 'Ring' ) : __( 'Signal' ) }
						</button>
					) ) }
				</div>
			</div>
			<div className={ styles.row }>
				<span className={ styles.rowLabel }>{ __( 'Purchase UI' ) }</span>
				<div className={ styles.buttons }>
					{ (
						[
							[ 'cards', __( 'Cards' ) ],
							[ 'presets', __( 'Presets + custom' ) ],
							[ 'slider', __( 'Slider' ) ],
						] as Array< [ PurchaseCreditsVariant, string ] >
					 ).map( ( [ value, label ] ) => (
						<button
							key={ value }
							type="button"
							className={ styles.stateButton }
							data-selected={ purchaseCreditsVariant === value ? '' : undefined }
							onClick={ () => setUsageExplorationPurchaseCreditsVariant( value ) }
						>
							{ label }
						</button>
					) ) }
				</div>
			</div>
			<div className={ styles.row }>
				<span className={ styles.rowLabel }>{ __( 'Checkout' ) }</span>
				<div className={ styles.buttons }>
					{ (
						[
							[ 'modal', __( 'Modal' ) ],
							[ 'external', __( 'WordPress.com' ) ],
						] as Array< [ PurchaseCreditsFlow, string ] >
					 ).map( ( [ value, label ] ) => (
						<button
							key={ value }
							type="button"
							className={ styles.stateButton }
							data-selected={ purchaseCreditsFlow === value ? '' : undefined }
							onClick={ () => setUsageExplorationPurchaseCreditsFlow( value ) }
						>
							{ label }
						</button>
					) ) }
				</div>
			</div>
			{ meterStyle === 'signal' ? (
				<>
					<div className={ styles.row }>
						<label className={ styles.rowLabel } htmlFor="usage-meter-icon-size">
							{ __( 'Icon size' ) }
						</label>
						<input
							id="usage-meter-icon-size"
							className={ styles.numberInput }
							type="number"
							min="14"
							max="24"
							value={ meterIconSize }
							onChange={ ( event ) =>
								setUsageExplorationMeterIconSize( Number( event.target.value ) )
							}
						/>
					</div>
					<div className={ styles.row }>
						<span className={ styles.rowLabel }>{ __( 'Stack' ) }</span>
						<div className={ styles.buttons }>
							{ ( [ 'vertical', 'horizontal' ] as UsageSignalOrientation[] ).map( ( option ) => (
								<button
									key={ option }
									type="button"
									className={ styles.stateButton }
									data-selected={ signalOrientation === option ? '' : undefined }
									onClick={ () => setUsageExplorationSignalOrientation( option ) }
								>
									{ option === 'horizontal' ? __( 'Horizontal' ) : __( 'Vertical' ) }
								</button>
							) ) }
						</div>
					</div>
					<div className={ styles.row }>
						<label className={ styles.rowLabel } htmlFor="usage-signal-bar-thickness">
							{ __( 'Thickness' ) }
						</label>
						<input
							id="usage-signal-bar-thickness"
							className={ styles.numberInput }
							type="number"
							min="1"
							max="5"
							step="0.5"
							value={ signalBarThickness }
							onChange={ ( event ) =>
								setUsageExplorationSignalBarThickness( Number( event.target.value ) )
							}
						/>
					</div>
					<div className={ styles.row }>
						<span className={ styles.rowLabel }>{ __( 'Align' ) }</span>
						<div className={ styles.buttons }>
							{ ( [ 'start', 'center', 'end' ] as UsageSignalAlignment[] ).map( ( option ) => (
								<button
									key={ option }
									type="button"
									className={ styles.stateButton }
									data-selected={ signalAlignment === option ? '' : undefined }
									onClick={ () => setUsageExplorationSignalAlignment( option ) }
								>
									{ option === 'center'
										? __( 'Center' )
										: signalOrientation === 'horizontal'
										? option === 'start'
											? __( 'Top' )
											: __( 'Bottom' )
										: option === 'start'
										? __( 'Left' )
										: __( 'Right' ) }
								</button>
							) ) }
						</div>
					</div>
					<div className={ styles.row }>
						<label className={ styles.rowLabel } htmlFor="usage-signal-bar-count">
							{ __( 'Bars' ) }
						</label>
						<input
							id="usage-signal-bar-count"
							className={ styles.numberInput }
							type="number"
							min="2"
							max="8"
							value={ signalBarCount }
							onChange={ ( event ) =>
								setUsageExplorationSignalBarCount( Number( event.target.value ) )
							}
						/>
					</div>
					<div className={ styles.row }>
						<span className={ styles.rowLabel }>{ __( 'Order' ) }</span>
						<div className={ styles.buttons }>
							{ ( [ 'ascending', 'descending' ] as UsageSignalStackDirection[] ).map(
								( option ) => (
									<button
										key={ option }
										type="button"
										className={ styles.stateButton }
										data-selected={ signalStackDirection === option ? '' : undefined }
										onClick={ () => setUsageExplorationSignalStackDirection( option ) }
									>
										{ option === 'ascending' ? __( 'Small → large' ) : __( 'Large → small' ) }
									</button>
								)
							) }
						</div>
					</div>
				</>
			) : (
				<>
					<div className={ styles.row }>
						<label className={ styles.rowLabel } htmlFor="usage-ring-size">
							{ __( 'Ring size' ) }
						</label>
						<input
							id="usage-ring-size"
							className={ styles.numberInput }
							type="number"
							min="14"
							max="28"
							value={ ringSize }
							onChange={ ( event ) => setUsageExplorationRingSize( Number( event.target.value ) ) }
						/>
					</div>
					<div className={ styles.row }>
						<label className={ styles.rowLabel } htmlFor="usage-ring-stroke-width">
							{ __( 'Line thickness' ) }
						</label>
						<input
							id="usage-ring-stroke-width"
							className={ styles.numberInput }
							type="number"
							min="1"
							max="6"
							step="0.25"
							value={ ringStrokeWidth }
							onChange={ ( event ) =>
								setUsageExplorationRingStrokeWidth( Number( event.target.value ) )
							}
						/>
					</div>
				</>
			) }
			<ScenarioRow
				label={ __( 'Purchased' ) }
				options={ PURCHASED_SCENARIOS }
				selected={ scenario }
			/>
			<div className={ styles.row }>
				<label className={ styles.rowLabel } htmlFor="usage-credit-adjustment">
					{ __( 'Adjust' ) }
				</label>
				<div className={ styles.buttons }>
					<input
						id="usage-credit-adjustment"
						className={ styles.creditInput }
						type="number"
						min="10000"
						step="10000"
						value={ creditAdjustment }
						onChange={ ( event ) =>
							setCreditAdjustment( Math.max( 0, Number( event.target.value ) ) )
						}
					/>
					<button
						type="button"
						className={ styles.stateButton }
						onClick={ () => addExplorationCredits( dollarsFromCredits( creditAdjustment ) ) }
					>
						{ __( 'Add' ) }
					</button>
					<button
						type="button"
						className={ styles.stateButton }
						onClick={ () =>
							spendExplorationPurchasedCredits( dollarsFromCredits( creditAdjustment ) )
						}
					>
						{ __( 'Use' ) }
					</button>
				</div>
			</div>
			<span className={ styles.shortcut }>{ __( 'Toggle with ⌘⇧U' ) }</span>
		</aside>
	);
}
