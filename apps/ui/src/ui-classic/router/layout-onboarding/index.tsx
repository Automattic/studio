import { createRoute, Outlet, useLocation, useMatches, useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

interface OnboardingProgressContextValue {
	setProgress: Dispatch< SetStateAction< string | null > >;
}

const OnboardingProgressContext = createContext< OnboardingProgressContextValue | null >( null );

export function useOnboardingProgress(): OnboardingProgressContextValue {
	const value = useContext( OnboardingProgressContext );
	if ( ! value ) throw new Error( 'useOnboardingProgress must be used inside onboarding' );
	return value;
}

interface OnboardingShellViewProps {
	children: ReactNode;
	hasSites: boolean;
	isWide: boolean;
	pathname: string;
	onClose: () => void;
}

export function OnboardingShellView( {
	children,
	hasSites,
	isWide,
	pathname,
	onClose,
}: OnboardingShellViewProps ) {
	const [ progress, setProgress ] = useState< string | null >( null );
	const contentRef = useRef< HTMLDivElement >( null );
	const progressContext = useMemo( () => ( { setProgress } ), [] );

	useEffect( () => {
		const heading = contentRef.current?.querySelector< HTMLElement >( 'h1' );
		if ( ! heading ) return;
		heading.tabIndex = -1;
		heading.focus();
	}, [ pathname ] );

	// Escape closes the flow, matching settings. Menus, selects, and dialogs
	// handle their own Escape and call preventDefault first, so honoring
	// defaultPrevented keeps Escape from closing onboarding out from under an
	// open popover. Mirrors the close button: hidden without sites, disabled
	// while a submit is in flight.
	useEffect( () => {
		if ( ! hasSites ) return;
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented && ! progress ) {
				onClose();
			}
		};
		document.addEventListener( 'keydown', handleKeyDown );
		return () => document.removeEventListener( 'keydown', handleKeyDown );
	}, [ hasSites, progress, onClose ] );

	return (
		<OnboardingProgressContext.Provider value={ progressContext }>
			<OnboardingLayout
				onClose={ hasSites ? onClose : undefined }
				closeDisabled={ !! progress }
				width={ isWide ? 'wide' : 'default' }
				contentRef={ contentRef }
				background={
					<div aria-hidden="true" className={ styles.dotGridLayer }>
						<DotGrid spacing={ 32 } crossSize={ 5 } opacity={ 0.2 } />
					</div>
				}
			>
				{ progress && (
					<p className={ styles.progress } role="status" aria-live="polite">
						{ progress }
					</p>
				) }
				<div className={ styles.outlet } inert={ progress ? true : undefined }>
					{ children }
				</div>
			</OnboardingLayout>
		</OnboardingProgressContext.Provider>
	);
}

export function OnboardingShell() {
	const navigate = useNavigate();
	const pathname = useLocation( { select: ( location ) => location.pathname } );
	const { data: sites } = useSites();
	const matches = useMatches();
	return (
		<OnboardingShellView
			hasSites={ ( sites?.length ?? 0 ) > 0 }
			isWide={ matches.some(
				( match ) =>
					match.pathname === '/onboarding' ||
					match.pathname === '/onboarding/connect' ||
					match.pathname === '/onboarding/tour'
			) }
			pathname={ pathname }
			onClose={ () => void navigate( { to: '/' } ) }
		>
			<Outlet />
		</OnboardingShellView>
	);
}

export const onboardingLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'onboarding-layout',
	component: OnboardingShell,
} );
