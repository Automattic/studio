import { useCallback, useEffect } from 'react';
import {
	Tldraw,
	TldrawSelectionForeground,
	type Editor,
	type TLComponents,
	type TLEventInfo,
	type TLSelectionForegroundProps,
	type TldrawOptions,
	useEditor,
	useValue,
} from 'tldraw';
import 'tldraw/tldraw.css';
import { deskShapeUtils } from '@/ui-desks/shapes/registry';
import { StackBadges } from '@/ui-desks/stacks/badges';
import { getStackId, isStackExpanded } from '@/ui-desks/stacks/utils';
import { useDesk, useRegisterDeskEditor } from './provider';
import styles from './style.module.css';

const deskCanvasOptions = {
	createTextOnCanvasDoubleClick: false,
} satisfies Partial< TldrawOptions >;

const deskCanvasComponents = {
	ContextMenu: null,
	InFrontOfTheCanvas: DeskCanvasOverlays,
	SelectionForeground: StackAwareSelectionForeground,
} satisfies Partial< TLComponents >;

function DeskCanvasOverlays() {
	return (
		<>
			<DeskCanvasHoverStateSync />
			<StackBadges />
		</>
	);
}

function DeskCanvasHoverStateSync() {
	const editor = useEditor();

	useEffect( () => {
		const markHoveringCanvas = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' || info.name !== 'pointer_move' ) {
				return;
			}

			const instanceState = editor.getInstanceState();
			if ( instanceState.isCoarsePointer || instanceState.isHoveringCanvas === true ) {
				return;
			}

			editor.updateInstanceState( { isHoveringCanvas: true } );
		};
		const markNotHoveringCanvas = () => {
			if ( editor.getInstanceState().isHoveringCanvas === false ) {
				return;
			}

			editor.updateInstanceState( { isHoveringCanvas: false } );
		};
		const handleVisibilityChange = () => {
			if ( document.visibilityState === 'hidden' ) {
				markNotHoveringCanvas();
			}
		};

		editor.on( 'event', markHoveringCanvas );
		window.addEventListener( 'blur', markNotHoveringCanvas );
		document.addEventListener( 'visibilitychange', handleVisibilityChange );
		return () => {
			editor.off( 'event', markHoveringCanvas );
			window.removeEventListener( 'blur', markNotHoveringCanvas );
			document.removeEventListener( 'visibilitychange', handleVisibilityChange );
		};
	}, [ editor ] );

	return null;
}

function StackAwareSelectionForeground( props: TLSelectionForegroundProps ) {
	const editor = useEditor();
	const hideForStack = useValue(
		'desk-stack-selection-foreground',
		() => {
			const selectedShapeIds = editor.getSelectedShapeIds();
			if ( selectedShapeIds.length === 0 ) {
				return false;
			}

			let selectedStackId: string | null = null;
			let hasExpandedStackMember = false;
			for ( const shapeId of selectedShapeIds ) {
				const shape = editor.getShape( shapeId );
				const stackId = getStackId( shape );
				if ( ! stackId ) {
					return false;
				}

				if ( selectedStackId === null ) {
					selectedStackId = stackId;
				} else if ( selectedStackId !== stackId ) {
					return false;
				}

				hasExpandedStackMember = hasExpandedStackMember || isStackExpanded( shape );
			}

			return selectedStackId !== null && ! hasExpandedStackMember;
		},
		[ editor ]
	);

	if ( hideForStack ) {
		return null;
	}

	return <TldrawSelectionForeground { ...props } />;
}

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
				components={ deskCanvasComponents }
				shapeUtils={ deskShapeUtils }
				onMount={ handleMount }
			/>
		</div>
	);
}
