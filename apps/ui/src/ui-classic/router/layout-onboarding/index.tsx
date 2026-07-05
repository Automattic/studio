import { createRoute, Outlet, useLocation, useMatches, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { DotGrid } from '@/components/dot-grid';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

export function OnboardingShell() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const hasSites = ( sites?.length ?? 0 ) > 0;
	// Grid-heavy pages (onboarding home with its flow picker cards, and the
	// blueprint selector's "select" step) need more horizontal room than the
	// single-column form pages; thread the variant through here so each child
	// route doesn't have to re-declare its own layout chrome. The blueprint
	// "configure" step reuses the shared site form and should match the
	// narrow "/onboarding/create" width.
	const matches = useMatches();
	const isFull = matches.some( ( match ) => match.pathname === '/onboarding/connect' );
	const isWide = matches.some( ( match ) => {
		if ( match.pathname === '/onboarding' ) return true;
		if ( match.pathname === '/onboarding/tour' ) return true;
		if ( match.pathname === '/onboarding/start' ) return true;
		if ( match.pathname === '/onboarding/plugin' ) return true;
		if ( match.pathname === '/onboarding/plugin/connect' ) return true;
		if ( match.pathname !== '/onboarding/blueprint' ) return false;
		const step = ( match.search as { step?: string } ).step;
		return step !== 'configure';
	} );
	// The dot grid backs every step of the flow; it stays mounted across
	// navigations so its intro sweep plays once per visit, not per step.
	const dotGrid = (
		<div aria-hidden="true" className={ styles.dotGridLayer }>
			<DotGrid spacing={ 32 } crossSize={ 5 } opacity={ 0.2 } />
		</div>
	);
	// Moving between onboarding pages/steps unmounts the control that was
	// focused (a card, a Back button), dropping keyboard focus to <body>.
	// Hand it to the incoming page's heading instead so keyboard and
	// screen-reader context follows the navigation.
	const contentRef = useRef< HTMLDivElement >( null );
	const { href } = useLocation();
	const lastHref = useRef( href );
	useEffect( () => {
		if ( lastHref.current === href ) {
			return;
		}
		lastHref.current = href;
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
		// The blueprint/import configure steps render empty for one frame
		// while adopting a pending hand-off; retry once after paint.
		if ( ! focusHeading() ) {
			const raf = requestAnimationFrame( () => void focusHeading() );
			return () => cancelAnimationFrame( raf );
		}
	}, [ href ] );

	return (
		<OnboardingLayout
			onClose={ hasSites ? () => void navigate( { to: '/' } ) : undefined }
			width={ isFull ? 'full' : isWide ? 'wide' : 'default' }
			background={ dotGrid }
		>
			{ /* display: contents — focus-management hook point only, no layout. */ }
			<div ref={ contentRef } className={ styles.outlet }>
				<Outlet />
			</div>
		</OnboardingLayout>
	);
}

export const onboardingLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'onboarding-layout',
	component: OnboardingShell,
} );
