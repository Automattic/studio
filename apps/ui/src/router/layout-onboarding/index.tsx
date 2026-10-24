import { createRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useSites } from '@/data/queries/use-sites';
import { OnboardingLayout } from '@/features/onboarding';
import { DotGrid } from '@/lib/ui';
import { rootRoute } from '../layout-root';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface OnboardingShellViewProps {
	children: ReactNode;
	hasSites: boolean;
	pathname: string;
	onClose: () => void;
}

export function OnboardingShellView( {
	children,
	hasSites,
	pathname,
	onClose,
}: OnboardingShellViewProps ) {
	const contentRef = useRef< HTMLDivElement >( null );

	useEffect( () => {
		const heading = contentRef.current?.querySelector< HTMLElement >( 'h1' );
		if ( ! heading ) return;
		heading.tabIndex = -1;
		heading.focus();
	}, [ pathname ] );

	// Escape closes the flow, matching settings. Menus, selects, and dialogs
	// handle their own Escape and call preventDefault first, so honoring
	// defaultPrevented keeps Escape from closing onboarding out from under an
	// open popover. Mirrors the close button: hidden without sites.
	useEffect( () => {
		if ( ! hasSites ) return;
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				onClose();
			}
		};
		document.addEventListener( 'keydown', handleKeyDown );
		return () => document.removeEventListener( 'keydown', handleKeyDown );
	}, [ hasSites, onClose ] );

	return (
		<OnboardingLayout
			onClose={ hasSites ? onClose : undefined }
			width="wide"
			contentRef={ contentRef }
			background={
				<div aria-hidden="true" className={ styles.dotGridLayer }>
					<DotGrid spacing={ 32 } crossSize={ 5 } opacity={ 0.2 } />
				</div>
			}
		>
			<div className={ styles.outlet }>{ children }</div>
		</OnboardingLayout>
	);
}

function OnboardingShell() {
	const navigate = useNavigate();
	const pathname = useLocation( { select: ( location ) => location.pathname } );
	const { data: sites } = useSites();
	return (
		<OnboardingShellView
			hasSites={ ( sites?.length ?? 0 ) > 0 }
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
