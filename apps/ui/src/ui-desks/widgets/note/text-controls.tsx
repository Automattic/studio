import { __ } from '@wordpress/i18n';
import { plus, reset, update } from '@wordpress/icons';
import { IconControlButton } from '@/ui-desks/components';
import { getNoteTextSize } from './text-sizing';
import { NOTE_TEXT_SIZE_COUNT, type NoteWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function NoteTextSizeControl( {
	props,
	updateProps,
}: ControlRenderContext< NoteWidgetProps > ) {
	const textSize = getNoteTextSize( props );

	return (
		<>
			<IconControlButton
				icon={ reset }
				label={ __( 'Decrease text size' ) }
				variant="toolbar"
				disabled={ textSize <= 0 }
				onClick={ () => updateProps( { textSize: textSize - 1 } ) }
			/>
			<IconControlButton
				icon={ plus }
				label={ __( 'Increase text size' ) }
				variant="toolbar"
				disabled={ textSize >= NOTE_TEXT_SIZE_COUNT - 1 }
				onClick={ () => updateProps( { textSize: textSize + 1 } ) }
			/>
		</>
	);
}

export function NoteFitTextControl( {
	fitSelectedWidgetToContent,
}: ControlRenderContext< NoteWidgetProps > ) {
	return (
		<IconControlButton
			icon={ update }
			label={ __( 'Fit text' ) }
			variant="toolbar"
			disabled={ ! fitSelectedWidgetToContent }
			onClick={ fitSelectedWidgetToContent }
		/>
	);
}
