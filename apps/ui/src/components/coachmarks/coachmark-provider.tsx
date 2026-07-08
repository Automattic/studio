import { __, sprintf } from '@wordpress/i18n';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useAnchorRegistry } from './anchor-registry';
import { Spotlight } from './spotlight';
import { StepCard } from './step-card';
import styles from './style.module.css';
import { useAnchorRect } from './use-anchor-rect';
import type { CoachmarkContent, TourDefinition } from '@/data/onboarding/types';
import type { ReactNode } from 'react';

export type CoachmarkEndReason = 'completed' | 'dismissed' | 'anchor-lost' | 'navigated';

interface CoachmarkEndOptions {
	onEnd?: ( reason: CoachmarkEndReason ) => void;
}

interface ActiveTour {
	kind: 'tour';
	tour: TourDefinition;
	stepIndex: number;
}
interface ActiveSingle {
	kind: 'single';
	step: CoachmarkContent;
	source: 'checklist' | 'event';
}
type ActiveCoachmarks = ActiveTour | ActiveSingle | null;

interface CoachmarkApi {
	active: ActiveCoachmarks;
	startTour( tour: TourDefinition, options?: CoachmarkEndOptions ): void;
	showCoachmark(
		step: CoachmarkContent,
		options?: CoachmarkEndOptions & { source?: 'checklist' | 'event' }
	): void;
	next(): void;
	back(): void;
	dismiss( reason?: CoachmarkEndReason ): void;
	// Advances a tour past an unreachable step, or ends a single coachmark.
	skip(): void;
}

const CoachmarkContext = createContext< CoachmarkApi | null >( null );

export function CoachmarkProvider( { children }: { children: ReactNode } ) {
	const [ active, setActive ] = useState< ActiveCoachmarks >( null );
	// Mirror in a ref so the imperative next/back/skip read the latest value
	// without stale closures.
	const activeRef = useRef< ActiveCoachmarks >( null );
	const onEndRef = useRef< ( ( reason: CoachmarkEndReason ) => void ) | null >( null );

	const setActiveBoth = useCallback( ( next: ActiveCoachmarks ) => {
		activeRef.current = next;
		setActive( next );
	}, [] );

	const endActive = useCallback(
		( reason: CoachmarkEndReason ) => {
			const callback = onEndRef.current;
			onEndRef.current = null;
			setActiveBoth( null );
			callback?.( reason );
		},
		[ setActiveBoth ]
	);

	const startTour = useCallback(
		( tour: TourDefinition, options?: CoachmarkEndOptions ) => {
			onEndRef.current = options?.onEnd ?? null;
			setActiveBoth( { kind: 'tour', tour, stepIndex: 0 } );
		},
		[ setActiveBoth ]
	);

	const showCoachmark = useCallback(
		(
			step: CoachmarkContent,
			options?: CoachmarkEndOptions & { source?: 'checklist' | 'event' }
		) => {
			onEndRef.current = options?.onEnd ?? null;
			setActiveBoth( { kind: 'single', step, source: options?.source ?? 'event' } );
		},
		[ setActiveBoth ]
	);

	const next = useCallback( () => {
		const current = activeRef.current;
		if ( current?.kind === 'tour' ) {
			const nextIndex = current.stepIndex + 1;
			if ( nextIndex >= current.tour.steps.length ) {
				endActive( 'completed' );
			} else {
				setActiveBoth( { ...current, stepIndex: nextIndex } );
			}
		} else if ( current?.kind === 'single' ) {
			endActive( 'completed' );
		}
	}, [ endActive, setActiveBoth ] );

	const back = useCallback( () => {
		const current = activeRef.current;
		if ( current?.kind === 'tour' && current.stepIndex > 0 ) {
			setActiveBoth( { ...current, stepIndex: current.stepIndex - 1 } );
		}
	}, [ setActiveBoth ] );

	const dismiss = useCallback(
		( reason: CoachmarkEndReason = 'dismissed' ) => {
			if ( activeRef.current ) {
				endActive( reason );
			}
		},
		[ endActive ]
	);

	const skip = useCallback( () => {
		const current = activeRef.current;
		if ( current?.kind === 'tour' ) {
			const nextIndex = current.stepIndex + 1;
			if ( nextIndex >= current.tour.steps.length ) {
				// The last step was unreachable — count it done rather than
				// leaving a phantom incomplete tour.
				endActive( 'completed' );
			} else {
				setActiveBoth( { ...current, stepIndex: nextIndex } );
			}
		} else if ( current?.kind === 'single' ) {
			endActive( 'anchor-lost' );
		}
	}, [ endActive, setActiveBoth ] );

	const api = useMemo< CoachmarkApi >(
		() => ( { active, startTour, showCoachmark, next, back, dismiss, skip } ),
		[ active, startTour, showCoachmark, next, back, dismiss, skip ]
	);

	return (
		<CoachmarkContext.Provider value={ api }>
			{ children }
			<CoachmarkLayer />
		</CoachmarkContext.Provider>
	);
}

export function useCoachmarks(): CoachmarkApi {
	const api = useContext( CoachmarkContext );
	if ( ! api ) {
		throw new Error( 'useCoachmarks must be used within a CoachmarkProvider' );
	}
	return api;
}

// How long to wait for a step's anchor to appear before giving up: a generous
// window on first show (panels still mounting), a short grace once it has been
// seen (StrictMode/re-render churn, sidebar collapse).
const INITIAL_WAIT_MS = 3000;
const GRACE_MS = 300;

function CoachmarkLayer() {
	const { active, next, back, dismiss, skip } = useCoachmarks();
	const registry = useAnchorRegistry();
	const [ anchorElement, setAnchorElement ] = useState< HTMLElement | null >( null );

	const step: CoachmarkContent | null =
		active?.kind === 'tour'
			? active.tour.steps[ active.stepIndex ]
			: active?.kind === 'single'
			? active.step
			: null;
	const anchorId = step?.anchor ?? null;
	const stepKey =
		active?.kind === 'tour'
			? `tour:${ active.tour.id }:${ active.stepIndex }`
			: active?.kind === 'single'
			? `single:${ active.step.anchor }`
			: 'none';

	// Keep skip stable for the resolution loop below.
	const skipRef = useRef( skip );
	useEffect( () => {
		skipRef.current = skip;
	}, [ skip ] );

	// Resolve (and keep resolving) the current step's anchor. A single rAF loop
	// handles late mounts and visibility loss uniformly: it re-reads the
	// registry each frame, and skips the step if the anchor is missing longer
	// than the allowed budget.
	useEffect( () => {
		if ( ! anchorId ) {
			setAnchorElement( null );
			return;
		}
		let raf = 0;
		let cancelled = false;
		let everResolved = false;
		let missingSince: number | null = Date.now();

		const loop = () => {
			if ( cancelled ) {
				return;
			}
			const element = registry.getElement( anchorId );
			if ( element ) {
				everResolved = true;
				missingSince = null;
				setAnchorElement( ( prev ) => ( prev === element ? prev : element ) );
			} else {
				if ( missingSince === null ) {
					missingSince = Date.now();
				}
				const budget = everResolved ? GRACE_MS : INITIAL_WAIT_MS;
				if ( Date.now() - missingSince > budget ) {
					cancelled = true;
					setAnchorElement( null );
					skipRef.current();
					return;
				}
				setAnchorElement( null );
			}
			raf = requestAnimationFrame( loop );
		};
		raf = requestAnimationFrame( loop );
		return () => {
			cancelled = true;
			cancelAnimationFrame( raf );
		};
		// stepKey captures which step we're resolving; registry is stable.
	}, [ anchorId, stepKey, registry ] );

	const rect = useAnchorRect( anchorElement );

	if ( ! active || ! step ) {
		return null;
	}

	const isTour = active.kind === 'tour';
	const isLast = isTour ? active.stepIndex === active.tour.steps.length - 1 : true;
	const announcement = isTour
		? sprintf(
				/* translators: 1: current step, 2: total steps, 3: step title. */
				__( 'Step %1$d of %2$d: %3$s' ),
				active.stepIndex + 1,
				active.tour.steps.length,
				step.title()
		  )
		: step.title();

	return (
		<>
			{ /* Only dim once the target is measured — never a full-screen scrim
			     with no cutout while a step waits for its anchor to mount. */ }
			{ rect ? (
				<Spotlight
					rect={ rect }
					dimmed={ isTour }
					onClickOverlay={ isTour ? () => dismiss( 'dismissed' ) : undefined }
				/>
			) : null }
			{ anchorElement ? (
				<StepCard
					anchorElement={ anchorElement }
					title={ step.title() }
					description={ step.description() }
					placement={ step.placement }
					stepIndex={ isTour ? active.stepIndex : undefined }
					stepCount={ isTour ? active.tour.steps.length : undefined }
					isLast={ isLast }
					onNext={ next }
					onBack={ isTour && active.stepIndex > 0 ? back : undefined }
					onDismiss={ () => dismiss( 'dismissed' ) }
				/>
			) : null }
			<div className={ styles.srOnly } role="status" aria-live="polite">
				{ announcement }
			</div>
		</>
	);
}
