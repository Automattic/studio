import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { IconButton, Stack } from '@wordpress/ui';
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
	 * content (e.g. the blueprint selector).
	 */
	width?: 'default' | 'wide';
}

export function OnboardingLayout( {
	children,
	onClose,
	width = 'default',
}: OnboardingLayoutProps ) {
	return (
		<Stack align="center" justify="center" className={ styles.root }>
			{ onClose && (
				<IconButton
					className={ styles.close }
					variant="minimal"
					tone="neutral"
					size="default"
					icon={ close }
					label={ __( 'Close' ) }
					onClick={ onClose }
				/>
			) }
			<div className={ `${ styles.content } ${ width === 'wide' ? styles.contentWide : '' }` }>
				{ children }
			</div>
		</Stack>
	);
}
