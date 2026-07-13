import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { IconButton, Stack } from '@wordpress/ui';
import styles from './style.module.css';
import type { ReactNode, Ref } from 'react';

interface OnboardingLayoutProps {
	children: ReactNode;
	/**
	 * When provided, renders a close button in the top-right corner. Used on
	 * onboarding pages that are reachable while existing sites are present, so
	 * the user isn't trapped in the flow.
	 */
	onClose?: () => void;
	closeDisabled?: boolean;
	width?: 'default' | 'wide';
	contentRef?: Ref< HTMLDivElement >;
}

export function OnboardingLayout( {
	children,
	onClose,
	closeDisabled = false,
	width = 'default',
	contentRef,
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
					disabled={ closeDisabled }
				/>
			) }
			<div
				ref={ contentRef }
				className={ `${ styles.content } ${ width === 'wide' ? styles.contentWide : '' }` }
			>
				{ children }
			</div>
		</Stack>
	);
}
