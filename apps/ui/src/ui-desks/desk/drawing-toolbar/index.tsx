import { __ } from '@wordpress/i18n';
import { verse } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useState } from 'react';
import { useEditor, useValue } from 'tldraw';
import { Button, Surface } from '@/ui-desks/components';
import { useDesk } from '../provider';
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
			<Button
				className={ styles.drawingDoneButton }
				disabled={ isFinishing }
				label={ __( 'Stop drawing' ) }
				tooltipLabel={ false }
				variant="quiet"
				size="medium"
				onClick={ () => void handleFinishDrawing() }
			>
				{ __( 'Stop drawing' ) }
			</Button>
		</Surface>
	);
}
