import { __, _n, sprintf } from '@wordpress/i18n';
import { trash } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { useChats } from '@/ui-desks/chats/context';
import { Button, Divider } from '@/ui-desks/components';
import { useDesk } from '@/ui-desks/desk/provider';
import { getAnnotationSubmission, getAnnotationWidgets, removeAnnotationWidget } from './notes';
import {
	createAnnotationWidgetContextPrompt,
	formatAnnotationsAsPrompt,
	formatAnnotationsSubmittedMessage,
} from './prompt';
import type { SitePreviewWidget } from '../types';
import type { WidgetFocusModeToolbarProps } from '@/ui-desks/widgets/types';

export function SitePreviewAnnotationToolbar( {
	widget,
}: WidgetFocusModeToolbarProps< SitePreviewWidget > ) {
	const {
		focusMode,
		getFocusDeskSnapshot,
		isReadOnly,
		selectedWidgetToolbarItem,
		setFocusDesk,
		stopFocusMode,
	} = useDesk();
	const { startChatWithPrompt, isCreatingChat } = useChats();
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const focusDesk = focusMode?.widgetId === widget.id ? focusMode.focusDesk : null;
	const annotationWidgets = focusDesk ? getAnnotationWidgets( focusDesk ) : [];
	const annotationCount = annotationWidgets.length;
	const selectedAnnotationWidgetId =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		annotationWidgets.some(
			( annotationWidget ) => annotationWidget.id === selectedWidgetToolbarItem.widget.id
		)
			? selectedWidgetToolbarItem.widget.id
			: null;
	const isBusy = isCreatingChat || isSubmitting;

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

	const removeSelectedAnnotation = () => {
		if ( isReadOnly || ! selectedAnnotationWidgetId ) {
			return;
		}
		const snapshot = getFocusDeskSnapshot() ?? focusDesk;
		if ( ! snapshot ) {
			return;
		}
		setFocusDesk( removeAnnotationWidget( snapshot, selectedAnnotationWidgetId ) );
	};

	const submit = async () => {
		if ( annotationCount === 0 || isBusy ) {
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
		<>
			<Button
				label={ __( 'Cancel' ) }
				variant="quiet"
				size="medium"
				tooltipLabel={ false }
				onClick={ cancel }
			>
				{ __( 'Cancel' ) }
			</Button>
			{ annotationCount > 0 && (
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
			) }
			{ selectedAnnotationWidgetId && (
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
			) }
		</>
	);
}
