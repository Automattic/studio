import { __ } from '@wordpress/i18n';
import { pencil } from '@wordpress/icons';
import { useCallback, useEffect } from 'react';
import { Button, Divider } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './edit-controls.module.css';
import { useSiteCardEditSession } from './edit-session';
import { SITE_CARD_WIDGET_TYPE, type SiteCardWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SiteCardEditControl( _props: ControlRenderContext< SiteCardWidgetProps > ) {
	const { selectedWidgetToolbarItem, startFocusMode } = useDesk();
	const widget =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		selectedWidgetToolbarItem.widget.type === SITE_CARD_WIDGET_TYPE
			? selectedWidgetToolbarItem.widget
			: null;

	return (
		<Button
			icon={ pencil }
			label={ __( 'Edit site identity' ) }
			variant="quiet"
			size="medium"
			disabled={ ! widget }
			onClick={ () => {
				if ( widget ) {
					startFocusMode( widget.id );
				}
			} }
		/>
	);
}

export function SiteCardEditCancelControl( _props: ControlRenderContext< SiteCardWidgetProps > ) {
	const session = useFocusedSiteCardEditSession();
	const { isSaving } = session;
	const requestCancel = useCallback( () => session.requestAction( 'cancel' ), [ session ] );

	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				isSaving ||
				document.activeElement?.closest( '[role="dialog"]' )
			) {
				return;
			}

			event.preventDefault();
			requestCancel();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ isSaving, requestCancel ] );

	return (
		<Button
			label={ __( 'Cancel' ) }
			variant="quiet"
			size="medium"
			tooltipLabel={ false }
			disabled={ isSaving }
			onClick={ requestCancel }
		>
			{ __( 'Cancel' ) }
		</Button>
	);
}

export function SiteCardEditSaveControl( _props: ControlRenderContext< SiteCardWidgetProps > ) {
	const session = useFocusedSiteCardEditSession();
	const { isDirty, isSaving, canSave } = session;
	const label = isSaving ? __( 'Saving site identity' ) : __( 'Save' );

	return (
		<>
			<Divider />
			<Button
				label={ label }
				variant="filled"
				tone="primary"
				size="medium"
				tooltipLabel={ false }
				aria-busy={ isSaving }
				className={ isSaving ? styles.savingButton : undefined }
				disabled={ ! isDirty || ! canSave || isSaving }
				onClick={ () => session.requestAction( 'save' ) }
			>
				{ isSaving && <span className={ styles.spinner } aria-hidden="true" /> }
				<span>{ isSaving ? __( 'Saving' ) : __( 'Save' ) }</span>
			</Button>
		</>
	);
}

function useFocusedSiteCardEditSession() {
	const { focusMode, focusedWidget } = useDesk();
	const widgetId =
		focusMode?.widgetId === focusedWidget?.id && focusedWidget?.type === SITE_CARD_WIDGET_TYPE
			? focusedWidget.id
			: null;

	return useSiteCardEditSession( widgetId );
}
