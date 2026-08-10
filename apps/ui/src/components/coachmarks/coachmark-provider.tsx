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
import { CoachmarkBubble } from './coachmark-bubble';
import styles from './style.module.css';
import type { CoachmarkContent } from '@/data/onboarding/types';
import type { ReactNode } from 'react';

interface CoachmarkApi {
	// The coachmark currently showing (or resolving its anchor), else null.
	active: CoachmarkContent | null;
	// Show a single arrowed bubble pointing at its anchor. Replaces any bubble
	// already showing — we never stack coachmarks.
	showCoachmark( content: CoachmarkContent ): void;
	dismiss(): void;
}

const CoachmarkContext = createContext< CoachmarkApi | null >( null );

export function CoachmarkProvider( { children }: { children: ReactNode } ) {
	const [ active, setActive ] = useState< CoachmarkContent | null >( null );

	const showCoachmark = useCallback( ( content: CoachmarkContent ) => {
		setActive( content );
	}, [] );

	const dismiss = useCallback( () => {
		setActive( null );
	}, [] );

	const api = useMemo< CoachmarkApi >(
		() => ( { active, showCoachmark, dismiss } ),
		[ active, showCoachmark, dismiss ]
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

// How long to wait for the anchor to appear before giving up: a generous window
// on first show (panels still mounting), a short grace once it has been seen
// (StrictMode/re-render churn, sidebar collapse).
const INITIAL_WAIT_MS = 3000;
const GRACE_MS = 300;

function CoachmarkLayer() {
	const { active, dismiss } = useCoachmarks();
	const registry = useAnchorRegistry();
	const [ anchorElement, setAnchorElement ] = useState< HTMLElement | null >( null );

	const anchorId = active?.anchor ?? null;

	// Keep dismiss stable for the resolution loop below.
	const dismissRef = useRef( dismiss );
	useEffect( () => {
		dismissRef.current = dismiss;
	}, [ dismiss ] );

	// Resolve (and keep resolving) the anchor. A single rAF loop handles late
	// mounts and visibility loss uniformly: it re-reads the registry each frame,
	// and dismisses the coachmark if the anchor stays missing past the budget.
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
					dismissRef.current();
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
	}, [ anchorId, registry ] );

	if ( ! active ) {
		return null;
	}

	return (
		<>
			{ anchorElement ? (
				<CoachmarkBubble
					anchorElement={ anchorElement }
					title={ active.title() }
					description={ active.description() }
					placement={ active.placement }
					onDismiss={ dismiss }
				/>
			) : null }
			<div className={ styles.srOnly } role="status" aria-live="polite">
				{ active.title() }
			</div>
		</>
	);
}
