import { useSyncExternalStore } from 'react';

export type UsageExplorationScenario =
	| 'healthy'
	| 'warning'
	| 'critical'
	| 'exhausted'
	| 'extra-reserve'
	| 'extra-healthy'
	| 'extra-warning'
	| 'extra-critical'
	| 'extra-exhausted';

export interface UsageExplorationState {
	scenario: UsageExplorationScenario;
	monthlyUsed: number;
	monthlyLimit: number;
	purchasedBalance: number;
	purchasedTotal: number;
}

const STORAGE_KEY = 'studio-usage-exploration-state';

const SCENARIOS: Record< UsageExplorationScenario, Omit< UsageExplorationState, 'scenario' > > = {
	healthy: { monthlyUsed: 18, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	warning: { monthlyUsed: 40, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	critical: { monthlyUsed: 45, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	exhausted: { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 0 },
	'extra-reserve': { monthlyUsed: 18, monthlyLimit: 50, purchasedBalance: 50, purchasedTotal: 50 },
	'extra-healthy': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 32, purchasedTotal: 50 },
	'extra-warning': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 10, purchasedTotal: 50 },
	'extra-critical': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 5, purchasedTotal: 50 },
	'extra-exhausted': { monthlyUsed: 50, monthlyLimit: 50, purchasedBalance: 0, purchasedTotal: 50 },
};

function getInitialState(): UsageExplorationState {
	if ( typeof window !== 'undefined' ) {
		const stored = window.localStorage.getItem( STORAGE_KEY ) as UsageExplorationScenario | null;
		if ( stored && stored in SCENARIOS ) {
			return { scenario: stored, ...SCENARIOS[ stored ] };
		}
	}
	return { scenario: 'warning', ...SCENARIOS.warning };
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
	state = { scenario, ...SCENARIOS[ scenario ] };
	window.localStorage.setItem( STORAGE_KEY, scenario );
	emit();
}

export function addExplorationCredits( amount: number ) {
	const scenario = state.monthlyUsed < state.monthlyLimit ? 'extra-reserve' : 'extra-healthy';
	state = {
		...state,
		scenario,
		purchasedBalance: state.purchasedBalance + amount,
		purchasedTotal: state.purchasedTotal + amount,
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
