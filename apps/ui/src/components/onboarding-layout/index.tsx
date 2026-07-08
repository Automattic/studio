import { Stack } from '@wordpress/ui';
import { FullscreenChrome } from '@/components/fullscreen-chrome';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface OnboardingLayoutProps {
	children: ReactNode;
	/**
	 * When provided, renders a close button in the top-right corner. Used on
	 * onboarding pages that are reachable while existing sites are present, so
	 * the user isn't trapped in the flow.
	 */
	onClose?: () => void;
	/**
	 * Content width variant. Defaults to a narrow column (`'default'`) sized
	 * for forms and short cards; `'wide'` is used by pages that host grids of
	 * content (e.g. the blueprint selector); `'full'` is for thumbnail-heavy
	 * pages (the Connect a site picker) that scale with the window.
	 */
	width?: 'default' | 'wide' | 'full';
	/**
	 * Decorative layer rendered behind the content (e.g. the dot-grid
	 * backdrop). The caller positions it; it paints under the content and
	 * close button by DOM order.
	 */
	background?: ReactNode;
}

export function OnboardingLayout( {
	children,
	onClose,
	width = 'default',
	background,
}: OnboardingLayoutProps ) {
	return (
		<Stack align="flex-start" justify="center" className={ styles.root }>
			{ background }
			<FullscreenChrome onClose={ onClose } />
			<div
				className={ `${ styles.content } ${ width === 'wide' ? styles.contentWide : '' } ${
					width === 'full' ? styles.contentFull : ''
				}` }
			>
				{ children }
			</div>
		</Stack>
	);
}
