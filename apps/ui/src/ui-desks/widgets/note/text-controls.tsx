import { __ } from '@wordpress/i18n';
import { plus, reset } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';
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
			<Button
				icon={ reset }
				label={ __( 'Decrease text size' ) }
				variant="quiet"
				size="medium"
				disabled={ textSize <= 0 }
				onClick={ () => updateProps( { textSize: textSize - 1 } ) }
			/>
			<Button
				icon={ plus }
				label={ __( 'Increase text size' ) }
				variant="quiet"
				size="medium"
				disabled={ textSize >= NOTE_TEXT_SIZE_COUNT - 1 }
				onClick={ () => updateProps( { textSize: textSize + 1 } ) }
			/>
		</>
	);
}
