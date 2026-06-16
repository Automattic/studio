import { createRoute, Outlet, useLocation, useMatches, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useSites } from '@/data/queries/use-sites';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';

function OnboardingShell() {
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
	const isWide = matches.some( ( match ) => {
		if ( match.pathname === '/onboarding' ) return true;
		if ( match.pathname !== '/onboarding/blueprint' ) return false;
		const step = ( match.search as { step?: string } ).step;
		return step !== 'configure';
	} );
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
			// A page that claims focus itself wins over the default heading focus.
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
		if ( ! focusHeading() ) {
			const raf = requestAnimationFrame( () => void focusHeading() );
			return () => cancelAnimationFrame( raf );
		}
	}, [ href ] );
	return (
		<OnboardingLayout
			onClose={ hasSites ? () => void navigate( { to: '/' } ) : undefined }
			width={ isWide ? 'wide' : 'default' }
		>
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
