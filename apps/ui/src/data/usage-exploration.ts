import { useSyncExternalStore } from 'react';

export type UsageExplorationScenario =
	| 'fresh'
	| 'healthy'
	| 'warning'
	| 'critical'
	| 'exhausted'
	| 'extra-reserve'
	| 'extra-full'
	| 'extra-healthy'
	| 'extra-warning'
	| 'extra-critical'
	| 'extra-exhausted';

export type UsageMeterStyle = 'ring' | 'signal';
export type PurchaseCreditsVariant = 'cards' | 'presets' | 'slider';
export type PurchaseCreditsFlow = 'modal' | 'external';
export type UsageSignalOrientation = 'horizontal' | 'vertical';
export type UsageSignalAlignment = 'start' | 'center' | 'end';
export type UsageSignalStackDirection = 'ascending' | 'descending';

export interface UsageExplorationState {
	scenario: UsageExplorationScenario;
	meterStyle: UsageMeterStyle;
	purchaseCreditsVariant: PurchaseCreditsVariant;
	purchaseCreditsFlow: PurchaseCreditsFlow;
	signalOrientation: UsageSignalOrientation;
	signalAlignment: UsageSignalAlignment;
	signalBarCount: number;
	signalBarThickness: number;
	signalStackDirection: UsageSignalStackDirection;
	meterIconSize: number;
	ringSize: number;
	ringStrokeWidth: number;
	monthlyUsed: number;
	monthlyLimit: number;
	purchasedBalance: number;
	purchasedTotal: number;
}

const STORAGE_KEY = 'studio-usage-exploration-state';
const METER_STYLE_STORAGE_KEY = 'studio-usage-exploration-meter-style';
const PURCHASE_CREDITS_VARIANT_STORAGE_KEY = 'studio-usage-exploration-purchase-variant';
const PURCHASE_CREDITS_FLOW_STORAGE_KEY = 'studio-usage-exploration-purchase-flow';
const SIGNAL_ORIENTATION_STORAGE_KEY = 'studio-usage-exploration-signal-orientation';
const SIGNAL_ALIGNMENT_STORAGE_KEY = 'studio-usage-exploration-signal-alignment';
const SIGNAL_BAR_COUNT_STORAGE_KEY = 'studio-usage-exploration-signal-bar-count';
const SIGNAL_BAR_THICKNESS_STORAGE_KEY = 'studio-usage-exploration-signal-bar-thickness';
const SIGNAL_STACK_DIRECTION_STORAGE_KEY = 'studio-usage-exploration-signal-stack-direction';
const METER_ICON_SIZE_STORAGE_KEY = 'studio-usage-exploration-meter-icon-size';
const RING_SIZE_STORAGE_KEY = 'studio-usage-exploration-ring-size';
const RING_STROKE_WIDTH_STORAGE_KEY = 'studio-usage-exploration-ring-stroke-width';

// Balances are held in dollars, matching the `cost_usage` / `cost_cap` figures
// the quota endpoint returns. Credits are a display unit derived from them.
export const CREDITS_PER_DOLLAR = 10_000;

export function creditsFromDollars( dollars: number ): number {
	return Math.round( dollars * CREDITS_PER_DOLLAR );
}

export function dollarsFromCredits( credits: number ): number {
	return credits / CREDITS_PER_DOLLAR;
}

const SCENARIOS: Record<
	UsageExplorationScenario,
	Omit<
		UsageExplorationState,
		| 'scenario'
		| 'meterStyle'
		| 'purchaseCreditsVariant'
		| 'purchaseCreditsFlow'
		| 'signalOrientation'
		| 'signalAlignment'
		| 'signalBarCount'
		| 'signalBarThickness'
		| 'signalStackDirection'
		| 'meterIconSize'
		| 'ringSize'
		| 'ringStrokeWidth'
	>
> = {
	fresh: { monthlyUsed: 0, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	healthy: { monthlyUsed: 18, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	warning: { monthlyUsed: 40, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	critical: { monthlyUsed: 45, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	exhausted: { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	'extra-reserve': { monthlyUsed: 18, monthlyLimit: 50, purchasedBalance: 50, purchasedTotal: 50 },
	'extra-full': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 50, purchasedTotal: 50 },
	'extra-healthy': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 32, purchasedTotal: 50 },
	'extra-warning': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 10, purchasedTotal: 50 },
	'extra-critical': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 5, purchasedTotal: 50 },
	'extra-exhausted': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 50 },
};

function getInitialState(): UsageExplorationState {
	let meterStyle: UsageMeterStyle = 'ring';
	let purchaseCreditsVariant: PurchaseCreditsVariant = 'slider';
	let purchaseCreditsFlow: PurchaseCreditsFlow = 'modal';
	let signalOrientation: UsageSignalOrientation = 'vertical';
	let signalAlignment: UsageSignalAlignment = 'center';
	let signalBarCount = 3;
	let signalBarThickness = 3;
	let signalStackDirection: UsageSignalStackDirection = 'ascending';
	let meterIconSize = 20;
	let ringSize = 16;
	let ringStrokeWidth = 2;
	if ( typeof window !== 'undefined' ) {
		const storedMeterStyle = window.localStorage.getItem( METER_STYLE_STORAGE_KEY );
		if ( storedMeterStyle === 'ring' || storedMeterStyle === 'signal' ) {
			meterStyle = storedMeterStyle;
		} else if (
			storedMeterStyle === 'signal-horizontal' ||
			storedMeterStyle === 'signal-vertical'
		) {
			meterStyle = 'signal';
			signalOrientation = storedMeterStyle === 'signal-horizontal' ? 'horizontal' : 'vertical';
		}
		const storedPurchaseCreditsVariant = window.localStorage.getItem(
			PURCHASE_CREDITS_VARIANT_STORAGE_KEY
		);
		if (
			storedPurchaseCreditsVariant === 'cards' ||
			storedPurchaseCreditsVariant === 'presets' ||
			storedPurchaseCreditsVariant === 'slider'
		) {
			purchaseCreditsVariant = storedPurchaseCreditsVariant;
		}
		const storedPurchaseCreditsFlow = window.localStorage.getItem(
			PURCHASE_CREDITS_FLOW_STORAGE_KEY
		);
		if ( storedPurchaseCreditsFlow === 'modal' || storedPurchaseCreditsFlow === 'external' ) {
			purchaseCreditsFlow = storedPurchaseCreditsFlow;
		}
		const storedOrientation = window.localStorage.getItem( SIGNAL_ORIENTATION_STORAGE_KEY );
		if ( storedOrientation === 'horizontal' || storedOrientation === 'vertical' ) {
			signalOrientation = storedOrientation;
		}
		const storedAlignment = window.localStorage.getItem( SIGNAL_ALIGNMENT_STORAGE_KEY );
		if (
			storedAlignment === 'start' ||
			storedAlignment === 'center' ||
			storedAlignment === 'end'
		) {
			signalAlignment = storedAlignment;
		}
		const storedBarCount = Number( window.localStorage.getItem( SIGNAL_BAR_COUNT_STORAGE_KEY ) );
		if ( Number.isInteger( storedBarCount ) && storedBarCount >= 2 && storedBarCount <= 8 ) {
			signalBarCount = storedBarCount;
		}
		const storedBarThickness = Number(
			window.localStorage.getItem( SIGNAL_BAR_THICKNESS_STORAGE_KEY )
		);
		if (
			Number.isFinite( storedBarThickness ) &&
			storedBarThickness >= 1 &&
			storedBarThickness <= 5
		) {
			signalBarThickness = storedBarThickness;
		}
		const storedStackDirection = window.localStorage.getItem( SIGNAL_STACK_DIRECTION_STORAGE_KEY );
		if ( storedStackDirection === 'ascending' || storedStackDirection === 'descending' ) {
			signalStackDirection = storedStackDirection;
		}
		const storedIconSize = Number( window.localStorage.getItem( METER_ICON_SIZE_STORAGE_KEY ) );
		if ( Number.isInteger( storedIconSize ) && storedIconSize >= 14 && storedIconSize <= 24 ) {
			meterIconSize = storedIconSize;
		}
		const storedRingSize = Number( window.localStorage.getItem( RING_SIZE_STORAGE_KEY ) );
		if ( Number.isInteger( storedRingSize ) && storedRingSize >= 14 && storedRingSize <= 28 ) {
			ringSize = storedRingSize;
		}
		const storedRingStrokeWidth = Number(
			window.localStorage.getItem( RING_STROKE_WIDTH_STORAGE_KEY )
		);
		if (
			Number.isFinite( storedRingStrokeWidth ) &&
			storedRingStrokeWidth >= 1 &&
			storedRingStrokeWidth <= 6
		) {
			ringStrokeWidth = storedRingStrokeWidth;
		}
		const stored = window.localStorage.getItem( STORAGE_KEY ) as UsageExplorationScenario | null;
		if ( stored && stored in SCENARIOS ) {
			return {
				scenario: stored,
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
				...SCENARIOS[ stored ],
			};
		}
	}
	return {
		scenario: 'warning',
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
		...SCENARIOS.warning,
	};
}

let state = getInitialState();
const listeners = new Set< () => void >();

function emit() {
	for ( const listener of listeners ) {
		listener();
	}
}

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

export function setUsageExplorationScenario( scenario: UsageExplorationScenario ) {
	state = {
		scenario,
		meterStyle: state.meterStyle,
		purchaseCreditsVariant: state.purchaseCreditsVariant,
		purchaseCreditsFlow: state.purchaseCreditsFlow,
		signalOrientation: state.signalOrientation,
		signalAlignment: state.signalAlignment,
		signalBarCount: state.signalBarCount,
		signalBarThickness: state.signalBarThickness,
		signalStackDirection: state.signalStackDirection,
		meterIconSize: state.meterIconSize,
		ringSize: state.ringSize,
		ringStrokeWidth: state.ringStrokeWidth,
		...SCENARIOS[ scenario ],
	};
	window.localStorage.setItem( STORAGE_KEY, scenario );
	emit();
}

export function setUsageExplorationMeterStyle( meterStyle: UsageMeterStyle ) {
	state = { ...state, meterStyle };
	window.localStorage.setItem( METER_STYLE_STORAGE_KEY, meterStyle );
	emit();
}

export function setUsageExplorationPurchaseCreditsVariant(
	purchaseCreditsVariant: PurchaseCreditsVariant
) {
	state = { ...state, purchaseCreditsVariant };
	window.localStorage.setItem( PURCHASE_CREDITS_VARIANT_STORAGE_KEY, purchaseCreditsVariant );
	emit();
}

export function setUsageExplorationPurchaseCreditsFlow( purchaseCreditsFlow: PurchaseCreditsFlow ) {
	state = { ...state, purchaseCreditsFlow };
	window.localStorage.setItem( PURCHASE_CREDITS_FLOW_STORAGE_KEY, purchaseCreditsFlow );
	emit();
}

export function setUsageExplorationSignalOrientation( signalOrientation: UsageSignalOrientation ) {
	state = { ...state, signalOrientation };
	window.localStorage.setItem( SIGNAL_ORIENTATION_STORAGE_KEY, signalOrientation );
	emit();
}

export function setUsageExplorationSignalAlignment( signalAlignment: UsageSignalAlignment ) {
	state = { ...state, signalAlignment };
	window.localStorage.setItem( SIGNAL_ALIGNMENT_STORAGE_KEY, signalAlignment );
	emit();
}

export function setUsageExplorationSignalBarCount( signalBarCount: number ) {
	const nextCount = Math.max( 2, Math.min( 8, Math.round( signalBarCount ) ) );
	state = { ...state, signalBarCount: nextCount };
	window.localStorage.setItem( SIGNAL_BAR_COUNT_STORAGE_KEY, String( nextCount ) );
	emit();
}

export function setUsageExplorationSignalBarThickness( signalBarThickness: number ) {
	const nextThickness = Math.max( 1, Math.min( 5, signalBarThickness ) );
	state = { ...state, signalBarThickness: nextThickness };
	window.localStorage.setItem( SIGNAL_BAR_THICKNESS_STORAGE_KEY, String( nextThickness ) );
	emit();
}

export function setUsageExplorationSignalStackDirection(
	signalStackDirection: UsageSignalStackDirection
) {
	state = { ...state, signalStackDirection };
	window.localStorage.setItem( SIGNAL_STACK_DIRECTION_STORAGE_KEY, signalStackDirection );
	emit();
}

export function setUsageExplorationMeterIconSize( meterIconSize: number ) {
	const nextSize = Math.max( 14, Math.min( 24, Math.round( meterIconSize ) ) );
	state = { ...state, meterIconSize: nextSize };
	window.localStorage.setItem( METER_ICON_SIZE_STORAGE_KEY, String( nextSize ) );
	emit();
}

export function setUsageExplorationRingSize( ringSize: number ) {
	const nextSize = Math.max( 14, Math.min( 28, Math.round( ringSize ) ) );
	state = { ...state, ringSize: nextSize };
	window.localStorage.setItem( RING_SIZE_STORAGE_KEY, String( nextSize ) );
	emit();
}

export function setUsageExplorationRingStrokeWidth( ringStrokeWidth: number ) {
	const nextStrokeWidth = Math.max( 1, Math.min( 6, ringStrokeWidth ) );
	state = { ...state, ringStrokeWidth: nextStrokeWidth };
	window.localStorage.setItem( RING_STROKE_WIDTH_STORAGE_KEY, String( nextStrokeWidth ) );
	emit();
}

export function addExplorationCredits( amount: number ) {
	const scenario = state.monthlyUsed < state.monthlyLimit ? 'extra-reserve' : 'extra-healthy';
	const purchasedBalance = state.purchasedBalance + amount;
	state = {
		...state,
		scenario,
		purchasedBalance,
		// A top-up establishes a fresh gauge baseline at the new combined balance.
		purchasedTotal: purchasedBalance,
	};
	window.localStorage.setItem( STORAGE_KEY, scenario );
	emit();
}

export function spendExplorationPurchasedCredits( amount: number ) {
	const purchasedBalance = Math.max( 0, state.purchasedBalance - amount );
	const availableFraction = state.purchasedTotal > 0 ? purchasedBalance / state.purchasedTotal : 0;
	let scenario: UsageExplorationScenario = 'extra-healthy';
	if ( purchasedBalance <= 0 ) {
		scenario = 'extra-exhausted';
	} else if ( availableFraction <= 0.1 ) {
		scenario = 'extra-critical';
	} else if ( availableFraction <= 0.2 ) {
		scenario = 'extra-warning';
	}
	state = {
		...state,
		scenario,
		monthlyUsed: state.monthlyLimit,
		purchasedBalance,
	};
	window.localStorage.setItem( STORAGE_KEY, scenario );
	emit();
}

export function useUsageExploration(): UsageExplorationState & {
	monthlyFraction: number;
	purchasedFraction: number;
	availableBalance: number;
	isExhausted: boolean;
} {
	const snapshot = useSyncExternalStore(
		subscribe,
		() => state,
		() => state
	);
	const monthlyRemaining = Math.max( 0, snapshot.monthlyLimit - snapshot.monthlyUsed );
	const availableBalance = monthlyRemaining + snapshot.purchasedBalance;
	const purchasedUsed = snapshot.purchasedTotal - snapshot.purchasedBalance;
	return {
		...snapshot,
		monthlyFraction: Math.min( 1, snapshot.monthlyUsed / snapshot.monthlyLimit ),
		purchasedFraction:
			snapshot.purchasedTotal > 0 ? Math.min( 1, purchasedUsed / snapshot.purchasedTotal ) : 0,
		availableBalance,
		isExhausted: availableBalance <= 0,
	};
}
