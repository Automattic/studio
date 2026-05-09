import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useDeskConfig, useSaveDeskConfig } from '@/data/queries/use-desk-config';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { defaultUserDesk } from './default-desk';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	deskWidgetToCanvasShape,
} from './tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from './types';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

interface DeskContextValue {
	isLoading: boolean;
	canAddWidgets: boolean;
	addWidget: ( type: string ) => boolean;
}

interface DeskProviderProps {
	siteId?: string;
	children: ReactNode;
}

type RegisterDeskEditor = ( editor: Editor | null ) => void;

const defaultDeskContext = {
	isLoading: true,
	canAddWidgets: false,
	addWidget: () => false,
};

const DeskContext = createContext< DeskContextValue >( defaultDeskContext );
const DeskEditorRegistrationContext = createContext< RegisterDeskEditor >( noopRegisterEditor );

export function DeskProvider( { siteId, children }: DeskProviderProps ) {
	const { data: savedDesk, isLoading } = useDeskConfig( siteId );
	const { mutate: saveDeskConfig } = useSaveDeskConfig( siteId );
	const defaultDesk = useMemo( () => createDefaultDeskConfig( siteId ), [ siteId ] );
	const desk = ( savedDesk as DeskConfig | undefined ) ?? defaultDesk;
	const [ editor, setEditor ] = useState< Editor | null >( null );
	const [ isHydrated, setIsHydrated ] = useState( false );
	const hydratedRef = useRef( false );
	const creationOffsetRef = useRef( 0 );
	const saveTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		if ( ! isLoading && ! savedDesk ) {
			saveDeskConfig( defaultDesk );
		}
	}, [ defaultDesk, isLoading, savedDesk, saveDeskConfig ] );

	useEffect( () => {
		if ( ! editor || isLoading || hydratedRef.current ) {
			return;
		}

		hydratedRef.current = true;
		const existingShapes = editor.getCurrentPageShapes();
		if ( existingShapes.length > 0 ) {
			editor.deleteShapes( existingShapes.map( ( shape ) => shape.id ) );
		}
		if ( desk.widgets.length > 0 ) {
			editor.createShapes( desk.widgets.map( deskWidgetToCanvasShape ) );
		}
		if ( desk.viewport ) {
			editor.setCamera( desk.viewport, { immediate: true } );
		} else if ( desk.widgets.length > 0 ) {
			ensureContentVisible( editor );
		}
		editor.focus();
		setIsHydrated( true );
	}, [ desk, editor, isLoading ] );

	useEffect( () => {
		if ( ! editor ) {
			return;
		}

		const queueSave = () => {
			if ( ! hydratedRef.current ) {
				return;
			}

			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
			}

			saveTimerRef.current = setTimeout( () => {
				saveTimerRef.current = null;
				saveDeskConfig( createDeskConfigFromEditor( editor ) );
			}, 500 );
		};

		const unsubscribeDocument = editor.store.listen( queueSave, { scope: 'document' } );
		const unsubscribeSession = editor.store.listen(
			( { changes } ) => {
				if ( hasCameraChange( changes ) ) {
					queueSave();
				}
			},
			{ scope: 'session' }
		);

		return () => {
			if ( saveTimerRef.current ) {
				clearTimeout( saveTimerRef.current );
				saveTimerRef.current = null;
			}
			unsubscribeDocument();
			unsubscribeSession();
		};
	}, [ editor, saveDeskConfig ] );

	const registerEditor = useCallback( ( nextEditor: Editor | null ) => {
		setEditor( nextEditor );
		if ( ! nextEditor ) {
			hydratedRef.current = false;
			setIsHydrated( false );
		}
	}, [] );

	const addWidget = useCallback(
		( type: string ) => {
			if ( ! editor || ! isHydrated ) {
				return false;
			}

			const viewportCenter = editor.getViewportPageBounds().center;
			const offset = ( creationOffsetRef.current % 6 ) * 24;
			const widget = createDeskWidget( {
				id: createWidgetId(),
				type,
				center: {
					x: viewportCenter.x + offset,
					y: viewportCenter.y + offset,
				},
				zIndex: getNextZIndex( getCurrentDeskWidgets( editor ) ),
			} );

			if ( ! widget ) {
				return false;
			}

			const shape = deskWidgetToCanvasShape( widget );
			if ( ! shape.id ) {
				return false;
			}

			creationOffsetRef.current += 1;
			editor.createShape( shape ).select( shape.id );
			editor.setEditingShape( shape.id );
			editor.focus();
			return true;
		},
		[ editor, isHydrated ]
	);

	const value = useMemo(
		() => ( {
			isLoading,
			canAddWidgets: Boolean( editor ) && isHydrated,
			addWidget,
		} ),
		[ addWidget, editor, isHydrated, isLoading ]
	);

	return (
		<DeskEditorRegistrationContext.Provider value={ registerEditor }>
			<DeskContext.Provider value={ value }>{ children }</DeskContext.Provider>
		</DeskEditorRegistrationContext.Provider>
	);
}

export function useDesk() {
	return useContext( DeskContext );
}

export function useRegisterDeskEditor() {
	return useContext( DeskEditorRegistrationContext );
}

function getCurrentDeskWidgets( editor: Editor ) {
	return editor
		.getCurrentPageShapes()
		.map( canvasShapeToDeskWidget )
		.filter( ( widget ) => widget !== null );
}

function createDeskConfigFromEditor( editor: Editor ): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: canvasCameraToDeskViewport( editor.getCamera() ),
		widgets: getCurrentDeskWidgets( editor ),
	};
}

interface CanvasStoreChanges {
	added: Record< string, unknown >;
	updated: Record< string, readonly [ unknown, unknown ] >;
	removed: Record< string, unknown >;
}

function hasCameraChange( changes: CanvasStoreChanges ) {
	const updatedRecords = Object.values( changes.updated ).map( ( [ , nextRecord ] ) => nextRecord );
	const records = [
		...Object.values( changes.added ),
		...updatedRecords,
		...Object.values( changes.removed ),
	];
	return records.some( isCameraRecord );
}

function isCameraRecord( value: unknown ) {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( value as { typeName?: unknown } ).typeName === 'camera'
	);
}

function ensureContentVisible( editor: Editor ) {
	const shapes = editor.getCurrentPageShapes();
	if ( shapes.length === 0 ) {
		return;
	}

	const viewport = editor.getViewportPageBounds();
	const hasVisibleShape = shapes.some( ( shape ) => {
		const bounds = editor.getShapePageBounds( shape.id );
		return bounds ? viewport.collides( bounds ) : false;
	} );

	if ( ! hasVisibleShape ) {
		editor.zoomToFit( { animation: { duration: 0 } } );
	}
}

function createDefaultDeskConfig( siteId?: string ): DeskConfig {
	if ( siteId ) {
		return {
			version: DESK_CONFIG_VERSION,
			updatedAt: new Date().toISOString(),
			widgets: [],
		};
	}

	return defaultUserDesk;
}

function getNextZIndex( widgets: DeskWidget[] ) {
	const nextIndex =
		widgets.reduce( ( max, widget ) => {
			const numericIndex = Number( widget.zIndex.replace( /^a/, '' ) );
			return Number.isFinite( numericIndex ) ? Math.max( max, numericIndex ) : max;
		}, 0 ) + 1;

	return `a${ nextIndex }`;
}

function createWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `widget-${ Date.now().toString( 36 ) }`;
}

function noopRegisterEditor() {}
