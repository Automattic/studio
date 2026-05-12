import { __ } from '@wordpress/i18n';
import { verse } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useState } from 'react';
import { useEditor, useValue } from 'tldraw';
import { ControlButton, Surface } from '@/ui-desks/components';
import { useDesk } from './provider';
import styles from './style.module.css';

export function DeskDrawingToolbar() {
	const editor = useEditor();
	const { finishDrawing } = useDesk();
	const [ isFinishing, setIsFinishing ] = useState( false );
	const isDrawing = useValue( 'desk-is-drawing', () => editor.getCurrentToolId() === 'draw', [
		editor,
	] );

	const handleFinishDrawing = async () => {
		setIsFinishing( true );
		try {
			await finishDrawing();
		} finally {
			setIsFinishing( false );
		}
	};

	return (
		<Surface
			variant="glass"
			className={ styles.drawingToolbar }
			data-visible={ isDrawing ? 'true' : 'false' }
			role="toolbar"
			aria-label={ __( 'Drawing controls' ) }
			aria-hidden={ ! isDrawing }
			onPointerDown={ ( event ) => event.stopPropagation() }
		>
			<span className={ styles.drawingToolbarStatus }>
				<Icon icon={ verse } size={ 20 } />
			</span>
			<ControlButton
				className={ styles.drawingDoneButton }
				disabled={ isFinishing }
				label={ __( 'Done drawing' ) }
				tooltipLabel={ false }
				variant="toolbar"
				onClick={ () => void handleFinishDrawing() }
			>
				{ __( 'Done' ) }
			</ControlButton>
		</Surface>
	);
}
