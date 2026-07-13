import { createRoute, Outlet, useLocation, useMatches, useNavigate } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

	return (
		<OnboardingProgressContext.Provider value={ progressContext }>
			<OnboardingLayout
				onClose={ hasSites ? onClose : undefined }
				closeDisabled={ !! progress }
				width={ isWide ? 'wide' : 'default' }
				contentRef={ contentRef }
			>
				{ progress && (
					<p className={ styles.progress } role="status" aria-live="polite">
						{ progress }
					</p>
				) }
				<div inert={ progress ? true : undefined }>{ children }</div>
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
			isWide={ matches.some( ( match ) => match.pathname === '/onboarding' ) }
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
