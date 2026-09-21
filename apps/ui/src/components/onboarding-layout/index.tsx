import { Stack } from '@wordpress/ui';
import { FullscreenChrome } from '@/components/fullscreen-chrome';
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
	background?: ReactNode;
}

export function OnboardingLayout( {
	children,
	onClose,
	closeDisabled = false,
	width = 'default',
	contentRef,
	background,
}: OnboardingLayoutProps ) {
	return (
		<Stack align="flex-start" justify="center" className={ styles.root }>
			{ background }
			<FullscreenChrome onClose={ onClose } closeDisabled={ closeDisabled } />
			<div
				ref={ contentRef }
				className={ `${ styles.content } ${ width === 'wide' ? styles.contentWide : '' } ${
					onClose ? styles.contentWithClose : ''
				}` }
			>
				{ children }
			</div>
		</Stack>
	);
}
