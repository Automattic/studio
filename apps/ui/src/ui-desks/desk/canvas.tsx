import { useCallback, useEffect } from 'react';
import { Tldraw, type Editor, type TldrawOptions } from 'tldraw';
import 'tldraw/tldraw.css';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import { useDesk, useRegisterDeskEditor } from './provider';
import styles from './style.module.css';

const deskCanvasOptions = {
	createTextOnCanvasDoubleClick: false,
} satisfies Partial< TldrawOptions >;

export function DeskCanvas() {
	const { isLoading } = useDesk();
	const registerEditor = useRegisterDeskEditor();

	const handleMount = useCallback(
		( nextEditor: Editor ) => {
			registerEditor( nextEditor );
		},
		[ registerEditor ]
	);

	useEffect( () => {
		return () => {
			registerEditor( null );
		};
	}, [ registerEditor ] );

	if ( isLoading ) {
		return <div className={ styles.loading } />;
	}

	return (
		<div className={ styles.canvas }>
			<Tldraw
				hideUi
				autoFocus
				options={ deskCanvasOptions }
				shapeUtils={ deskShapeUtils }
				onMount={ handleMount }
			/>
		</div>
	);
}
