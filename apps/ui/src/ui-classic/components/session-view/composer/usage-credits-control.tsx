import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { AiCreditsDetailsDialog } from '@/components/ai-credits-details-dialog';
import * as Menu from '@/components/menu';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { PURCHASE_CREDITS_PROTOTYPE_URL } from '@/components/purchase-credits-dialog/events';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { creditsFromDollars, useUsageExploration } from '@/data/usage-exploration';
import styles from './style.module.css';

function AiCreditsRing( {
	usedFraction,
	size,
	strokeWidth,
}: {
	usedFraction: number;
	size: number;
	strokeWidth: number;
} ) {
	const usedPercentage = Math.max( 0, Math.min( 1, usedFraction ) ) * 100;

	return (
		<svg
			className={ styles.usageCreditsRing }
			data-keep-size
			viewBox="0 0 24 24"
			width={ size }
			height={ size }
			fill="none"
			aria-hidden="true"
		>
			<circle
				className={ styles.usageCreditsRingTrack }
				cx="12"
				cy="12"
				r="8"
				strokeWidth={ strokeWidth }
			/>
			<circle
				className={ styles.usageCreditsRingValue }
				cx="12"
				cy="12"
				r="8"
				pathLength="100"
				strokeWidth={ strokeWidth }
				strokeDasharray="100"
				strokeDashoffset={ 100 - usedPercentage }
				strokeLinecap="round"
				transform="rotate(-90 12 12)"
			/>
		</svg>
	);
}

function AiCreditsSignal( {
	usedFraction,
	orientation,
	alignment,
	barCount,
	barThickness,
	size,
	stackDirection,
}: {
	usedFraction: number;
	orientation: 'horizontal' | 'vertical';
	alignment: 'start' | 'center' | 'end';
	barCount: number;
	barThickness: number;
	size: number;
	stackDirection: 'ascending' | 'descending';
} ) {
	const filledBars = Math.ceil( Math.max( 0, Math.min( 1, usedFraction ) ) * barCount );
	const maxBarLength = size - 4;
	const minBarLength = Math.max( 4, Math.round( maxBarLength * 0.375 ) );
	const ascendingSizes = Array.from( { length: barCount }, ( _, index ) =>
		Math.round(
			minBarLength + ( ( maxBarLength - minBarLength ) * index ) / Math.max( 1, barCount - 1 )
		)
	);
	const sizes = stackDirection === 'ascending' ? ascendingSizes : [ ...ascendingSizes ].reverse();
	const thickness = Math.max(
		1,
		Math.min( barThickness, ( size - ( barCount - 1 ) * 2 ) / barCount )
	);

	return (
		<span
			className={ styles.usageCreditsSignal }
			data-orientation={ orientation }
			data-alignment={ alignment }
			style={ { width: size, height: size } }
			aria-hidden="true"
		>
			{ sizes.map( ( size, index ) => (
				<span
					key={ index }
					className={ styles.usageCreditsSignalBar }
					data-filled={ index < filledBars || undefined }
					style={
						orientation === 'horizontal'
							? { height: size, width: thickness }
							: { width: size, height: thickness }
					}
				/>
			) ) }
		</span>
	);
}

export function UsageCreditsControl() {
	const usage = useUsageExploration();
	const connector = useConnector();
	const locale = useUserLocale();
	const navigate = useNavigate();
	const [ menuOpen, setMenuOpen ] = useState( false );
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const [ detailsOpen, setDetailsOpen ] = useState( false );
	const credits = new Intl.NumberFormat( locale, {
		notation: 'compact',
		maximumFractionDigits: 0,
	} );
	const availableCredits = credits.format( creditsFromDollars( usage.availableBalance ) );
	const meterTotal = credits.format( creditsFromDollars( usage.meterTotal ) );
	const activeUsedFraction = usage.combinedFraction;
	const isCaution = activeUsedFraction >= 0.8 && activeUsedFraction < 0.9;
	const isWarning = activeUsedFraction >= 0.9;
	const opensExternalCheckout = usage.purchaseCreditsFlow === 'external';
	const openPurchaseCredits = () => {
		if ( opensExternalCheckout ) {
			void connector.openExternalUrl( PURCHASE_CREDITS_PROTOTYPE_URL );
			return;
		}
		setPurchaseOpen( true );
	};

	const tooltip = sprintf(
		/* translators: 1: AI credits available, 2: current meter baseline. */
		__( 'AI credits · %1$s / %2$s available' ),
		availableCredits,
		meterTotal
	);

	return (
		<>
			<Menu.Root modal={ false } open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Tooltip.Root disabled={ menuOpen }>
					<Menu.Trigger
						render={
							<Tooltip.Trigger
								render={
									<button
										type="button"
										className={ styles.usageCreditsButton }
										data-caution={ isCaution || undefined }
										data-warning={ isWarning || undefined }
										data-exhausted={ usage.isExhausted || undefined }
										aria-label={ __( 'View AI credit usage' ) }
									/>
								}
							>
								{ usage.meterStyle === 'ring' ? (
									<AiCreditsRing
										usedFraction={ activeUsedFraction }
										size={ usage.ringSize }
										strokeWidth={ usage.ringStrokeWidth }
									/>
								) : (
									<AiCreditsSignal
										usedFraction={ activeUsedFraction }
										orientation={ usage.signalOrientation }
										alignment={ usage.signalAlignment }
										barCount={ usage.signalBarCount }
										barThickness={ usage.signalBarThickness }
										size={ usage.meterIconSize }
										stackDirection={ usage.signalStackDirection }
									/>
								) }
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ tooltip }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Menu.Popup side="top" align="end" className={ styles.usageCreditsMenu }>
					<div className={ styles.usageCreditsRows }>
						<div className={ styles.usageCreditsRow }>
							<span>{ __( 'AI credits' ) }</span>
							<strong>
								{ sprintf(
									/* translators: 1: AI credits available, 2: current meter baseline. */
									__( '%1$s / %2$s available' ),
									availableCredits,
									meterTotal
								) }
							</strong>
							<div className={ styles.usageCreditsMenuTrack } aria-hidden="true">
								<div
									className={ styles.usageCreditsMenuValue }
									data-caution={ isCaution || undefined }
									data-warning={ isWarning || undefined }
									data-exhausted={ usage.isExhausted || undefined }
									style={ { inlineSize: `${ activeUsedFraction * 100 }%` } }
								/>
							</div>
						</div>
					</div>
					<Menu.Separator />
					<Menu.Item onClick={ openPurchaseCredits }>
						{ opensExternalCheckout ? __( 'Purchase AI credits' ) : __( 'Add AI credits' ) }
						{ opensExternalCheckout ? (
							<Icon icon={ external } size={ 14 } aria-hidden="true" />
						) : null }
					</Menu.Item>
					<Menu.Item onClick={ () => setDetailsOpen( true ) }>
						{ __( 'How AI credits work' ) }
					</Menu.Item>
					<Menu.Item
						onClick={ () => void navigate( { to: '/settings', search: { tab: 'usage' } } ) }
					>
						{ __( 'Usage settings' ) }
					</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
			<AiCreditsDetailsDialog open={ detailsOpen } onOpenChange={ setDetailsOpen } />
		</>
	);
}
