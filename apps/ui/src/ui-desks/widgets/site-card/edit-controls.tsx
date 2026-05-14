import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { Button, Divider } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './edit-controls.module.css';
import type { SiteCardWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SiteCardEditCancelControl( _props: ControlRenderContext< SiteCardWidgetProps > ) {
	const { isSiteCardEditSaving, requestSiteCardEditAction } = useDesk();

	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				isSiteCardEditSaving ||
				document.activeElement?.closest( '[role="dialog"]' )
			) {
				return;
			}

			event.preventDefault();
			requestSiteCardEditAction( 'cancel' );
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ isSiteCardEditSaving, requestSiteCardEditAction ] );

	return (
		<Button
			label={ __( 'Cancel' ) }
			variant="quiet"
			size="medium"
			tooltipLabel={ false }
			disabled={ isSiteCardEditSaving }
			onClick={ () => requestSiteCardEditAction( 'cancel' ) }
		>
			{ __( 'Cancel' ) }
		</Button>
	);
}

export function SiteCardEditSaveControl( _props: ControlRenderContext< SiteCardWidgetProps > ) {
	const { isSiteCardEditDirty, isSiteCardEditSaving, requestSiteCardEditAction } = useDesk();
	const label = isSiteCardEditSaving ? __( 'Saving site identity' ) : __( 'Save' );

	return (
		<>
			<Divider />
			<Button
				label={ label }
				variant="filled"
				tone="primary"
				size="medium"
				tooltipLabel={ false }
				aria-busy={ isSiteCardEditSaving }
				className={ isSiteCardEditSaving ? styles.savingButton : undefined }
				disabled={ ! isSiteCardEditDirty || isSiteCardEditSaving }
				onClick={ () => requestSiteCardEditAction( 'save' ) }
			>
				{ isSiteCardEditSaving && <span className={ styles.spinner } aria-hidden="true" /> }
				<span>{ isSiteCardEditSaving ? __( 'Saving' ) : __( 'Save' ) }</span>
			</Button>
		</>
	);
}
