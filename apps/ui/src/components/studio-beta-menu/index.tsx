import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { REPORT_ISSUE_URL } from '@/lib/docs-links';
import styles from './style.module.css';

export function StudioBetaMenu( { className }: { className?: string } ) {
	const connector = useConnector();
	const { data: appGlobals } = useAppGlobals();

	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<button
						type="button"
						className={ clsx( styles.trigger, className ) }
						aria-label={ __( 'Studio Beta options' ) }
					/>
				}
			>
				<span className={ styles.label }>{ __( 'Beta' ) }</span>
			</Menu.Trigger>
			<Menu.Popup side="top" align="start">
				{ connector.capabilities.switchToClassicUi ? (
					<Menu.Item onClick={ () => void connector.disableAgenticUi() }>
						{ __( 'Switch to classic' ) }
					</Menu.Item>
				) : null }
				<Menu.Item onClick={ () => void connector.openExternalUrl( REPORT_ISSUE_URL ) }>
					{ __( 'Report an issue' ) }
				</Menu.Item>
				{ appGlobals?.appVersion ? (
					<>
						<Menu.Separator />
						<Menu.Group>
							<Menu.GroupLabel>
								{
									// translators: %s: the running Studio version, e.g. "1.18.0-beta1".
									sprintf( __( 'Studio %s' ), appGlobals.appVersion )
								}
							</Menu.GroupLabel>
						</Menu.Group>
					</>
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}
