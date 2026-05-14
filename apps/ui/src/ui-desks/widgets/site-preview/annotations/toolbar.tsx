import { __, _n, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { useChats } from '@/ui-desks/chats/context';
import { Button, Divider } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_PREVIEW_WIDGET_TYPE } from '../types';
import { getAnnotationSubmission, getAnnotationWidgets, removeAnnotationWidget } from './notes';
import {
	createAnnotationWidgetContextPrompt,
	formatAnnotationsAsPrompt,
	formatAnnotationsSubmittedMessage,
} from './prompt';
import type { SitePreviewWidget, SitePreviewWidgetProps } from '../types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function SitePreviewAnnotationCancelControl(
	_props: ControlRenderContext< SitePreviewWidgetProps >
) {
	const { annotationCount, stopFocusMode } = useSitePreviewAnnotationControls();

	const cancel = () => {
		if ( annotationCount > 0 ) {
			const shouldDiscard = window.confirm(
				sprintf(
					_n( 'Discard %d annotation?', 'Discard %d annotations?', annotationCount ),
					annotationCount
				)
			);
			if ( ! shouldDiscard ) {
				return;
			}
		}
		stopFocusMode();
	};

	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				document.activeElement?.closest( '[role="dialog"]' )
			) {
				return;
			}
			event.preventDefault();
			cancel();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	} );

	return (
		<Button
			label={ __( 'Cancel' ) }
			variant="quiet"
			size="medium"
			tooltipLabel={ false }
			onClick={ cancel }
		>
			{ __( 'Cancel' ) }
		</Button>
	);
}

export function SitePreviewAnnotationSubmitControl(
	_props: ControlRenderContext< SitePreviewWidgetProps >
) {
	const { annotationCount, focusDesk, getFocusDeskSnapshot, stopFocusMode, widget } =
		useSitePreviewAnnotationControls();
	const { startChatWithPrompt, isCreatingChat } = useChats();
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const isBusy = isCreatingChat || isSubmitting;

	if ( ! widget || annotationCount === 0 ) {
		return null;
	}

	const submit = async () => {
		if ( isBusy ) {
			return;
		}
		const submission = getAnnotationSubmission( widget, getFocusDeskSnapshot() ?? focusDesk );
		if ( ! submission ) {
			return;
		}

		setIsSubmitting( true );
		try {
			const annotationPrompt = formatAnnotationsAsPrompt( submission.annotations );
			await startChatWithPrompt( {
				prompt: submission.previewWidget
					? createAnnotationWidgetContextPrompt( annotationPrompt, [ submission.previewWidget ] )
					: annotationPrompt,
				displayMessage: formatAnnotationsSubmittedMessage( submission.annotations.length ),
			} );
			stopFocusMode();
		} catch ( error ) {
			console.warn( 'Unable to submit annotations.', error );
		} finally {
			setIsSubmitting( false );
		}
	};

	return (
		<>
			<Divider />
			<Button
				label={ sprintf(
					_n( 'Submit %d change', 'Submit %d changes', annotationCount ),
					annotationCount
				) }
				variant="filled"
				tone="primary"
				size="medium"
				tooltipLabel={ false }
				disabled={ isBusy }
				onClick={ () => void submit() }
			>
				{ sprintf(
					_n( 'Submit %d change', 'Submit %d changes', annotationCount ),
					annotationCount
				) }
			</Button>
		</>
	);
}

export function SitePreviewAnnotationRemoveControl(
	_props: ControlRenderContext< SitePreviewWidgetProps >
) {
	const { focusDesk, getFocusDeskSnapshot, isReadOnly, selectedAnnotationWidgetId, setFocusDesk } =
		useSitePreviewAnnotationControls();

	if ( ! selectedAnnotationWidgetId ) {
		return null;
	}

	const removeSelectedAnnotation = () => {
		if ( isReadOnly ) {
			return;
		}
		const snapshot = getFocusDeskSnapshot() ?? focusDesk;
		if ( ! snapshot ) {
			return;
		}
		setFocusDesk( removeAnnotationWidget( snapshot, selectedAnnotationWidgetId ) );
	};

	return (
		<>
			<Divider />
			<Button
				icon={ trash }
				label={ __( 'Remove annotation' ) }
				variant="quiet"
				size="medium"
				onClick={ removeSelectedAnnotation }
			/>
		</>
	);
}

function useSitePreviewAnnotationControls() {
	const {
		focusMode,
		focusedWidget,
		getFocusDeskSnapshot,
		isReadOnly,
		selectedWidgetToolbarItem,
		setFocusDesk,
		stopFocusMode,
	} = useDesk();
	const widget =
		focusedWidget &&
		focusMode?.widgetId === focusedWidget.id &&
		focusedWidget.type === SITE_PREVIEW_WIDGET_TYPE
			? ( focusedWidget as SitePreviewWidget )
			: null;
	const focusDesk = widget ? focusMode?.focusDesk ?? null : null;
	const annotationWidgets = focusDesk ? getAnnotationWidgets( focusDesk ) : [];
	const annotationCount = annotationWidgets.length;
	const selectedAnnotationWidgetId =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		annotationWidgets.some(
			( annotationWidget ) => annotationWidget.id === selectedWidgetToolbarItem.widget.id
		)
			? selectedWidgetToolbarItem.widget.id
			: null;

	return {
		annotationCount,
		focusDesk,
		getFocusDeskSnapshot,
		isReadOnly,
		selectedAnnotationWidgetId,
		setFocusDesk,
		stopFocusMode,
		widget,
	};
}
