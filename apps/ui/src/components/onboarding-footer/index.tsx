import styles from './style.module.css';
import type { ReactNode } from 'react';

/**
 * Fixed action bar docked to the bottom of the onboarding flow, with a
 * progressive-blur scrim so content scrolls away underneath it — the
 * apps/ui counterpart of the desktop renderer's Add Site stepper.
 * `CreateSiteForm` renders one around its actions; selector-style routes
 * render their own. The first child (Back) is pinned bottom-left and the
 * remaining actions sit bottom-right.
 */
export function OnboardingFooter( { children }: { children: ReactNode } ) {
	return (
		<>
			<div aria-hidden="true" className={ styles.scrim } />
			<div className={ styles.actions }>{ children }</div>
		</>
	);
}
