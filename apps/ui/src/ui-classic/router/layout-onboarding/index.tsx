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
	isFull?: boolean;
	isWide: boolean;
	pathname: string;
	onClose: () => void;
}

export function OnboardingShellView( {
	children,
	hasSites,
	isFull,
	isWide,
	pathname,
	onClose,
}: OnboardingShellViewProps ) {
	const [ progress, setProgress ] = useState< string | null >( null );
	const progressContext = useMemo( () => ( { setProgress } ), [] );

	// Moving between onboarding pages/steps unmounts the control that was
	// focused (a card, a Back button), dropping keyboard focus to <body>.
	// Hand it to the incoming page's heading instead so keyboard and
	// screen-reader context follows the navigation.
	const contentRef = useRef< HTMLDivElement >( null );
	const lastPathname = useRef( pathname );
	useEffect( () => {
		if ( lastPathname.current === pathname ) {
			return;
		}
		lastPathname.current = pathname;
		const focusHeading = () => {
			const content = contentRef.current;
			if ( ! content ) {
				return false;
			}
			// A page that claims focus itself (e.g. the create form focusing
			// its Site name field) wins over the default heading focus.
			const active = document.activeElement;
			if ( active && active !== document.body && content.contains( active ) ) {
				return true;
			}
			const heading = content.querySelector( 'h1' );
			if ( ! heading ) {
				return false;
			}
			heading.setAttribute( 'tabindex', '-1' );
			heading.focus();
			return true;
		};
		// The import configure step renders empty for one frame while
		// adopting a pending hand-off; retry once after paint.
		if ( ! focusHeading() ) {
			const raf = requestAnimationFrame( () => void focusHeading() );
			return () => cancelAnimationFrame( raf );
		}
	}, [ pathname ] );

	// The dot grid backs every step of the flow. It's already on screen from
	// the welcome screen (rendered statically there), so skip the intro sweep
	// to avoid replaying an entrance the user has effectively already seen.
	const dotGrid = (
		<div aria-hidden="true" className={ styles.dotGridLayer }>
			<DotGrid spacing={ 32 } crossSize={ 5 } opacity={ 0.2 } intro={ false } />
		</div>
	);

	return (
		<OnboardingProgressContext.Provider value={ progressContext }>
			<OnboardingLayout
				onClose={ hasSites ? onClose : undefined }
				closeDisabled={ !! progress }
				width={ isFull ? 'full' : isWide ? 'wide' : 'default' }
				background={ dotGrid }
			>
				{ progress && (
					<p className={ styles.progress } role="status" aria-live="polite">
						{ progress }
					</p>
				) }
				{ /* display: contents — focus-management hook point only, no layout. */ }
				<div ref={ contentRef } className={ styles.outlet } inert={ progress ? true : undefined }>
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
	// Grid-heavy pages (onboarding home with its flow picker cards) need more
	// horizontal room than the single-column form pages; thread the variant
	// through here so each child route doesn't have to re-declare its own
	// layout chrome.
	const matches = useMatches();
	const isFull = matches.some( ( match ) => match.pathname === '/onboarding/connect' );
	const isWide = matches.some( ( match ) => {
		if ( match.pathname === '/onboarding' ) return true;
		if ( match.pathname === '/onboarding/tour' ) return true;
		if ( match.pathname === '/onboarding/plugin' ) return true;
		if ( match.pathname === '/onboarding/plugin/connect' ) return true;
		return false;
	} );
	return (
		<OnboardingShellView
			hasSites={ ( sites?.length ?? 0 ) > 0 }
			isFull={ isFull }
			isWide={ isWide }
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
