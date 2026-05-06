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
}

export function OnboardingLayout( { children, onClose }: OnboardingLayoutProps ) {
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
			<div className={ styles.content }>{ children }</div>
		</Stack>
	);
}
