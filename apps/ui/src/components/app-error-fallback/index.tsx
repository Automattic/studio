import { WPCOM_SUPPORT_CONTACT_URL } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { error as errorIcon } from '@wordpress/icons';
import { Button, EmptyState } from '@wordpress/ui';
import { AppThemeScope } from '@/components/app-theme-scope';
import { useConnector } from '@/data/core';
import styles from './style.module.css';

/**
 * Replaces a view that crashed while rendering, or the whole window when the
 * app fails to start.
 */
export function AppErrorFallback() {
	const connector = useConnector();
	return (
		<AppThemeScope>
			<div className={ styles.root }>
				<EmptyState.Root>
					<EmptyState.Icon icon={ errorIcon } />
					<EmptyState.Title>{ __( 'Something went wrong' ) }</EmptyState.Title>
					<EmptyState.Description>
						{ __( 'Reload Studio to try again. If the problem continues, contact support.' ) }
					</EmptyState.Description>
					<EmptyState.Actions>
						<Button onClick={ () => window.location.reload() }>{ __( 'Reload' ) }</Button>
						<Button
							variant="minimal"
							tone="neutral"
							onClick={ () => void connector.openExternalUrl( WPCOM_SUPPORT_CONTACT_URL ) }
						>
							{ __( 'Contact support' ) }
						</Button>
					</EmptyState.Actions>
				</EmptyState.Root>
			</div>
		</AppThemeScope>
	);
}
