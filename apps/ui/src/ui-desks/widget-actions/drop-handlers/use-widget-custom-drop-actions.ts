import { store as coreDataStore } from '@wordpress/core-data';
import { useDispatch, useRegistry } from '@wordpress/data';
import { useCallback, useMemo } from 'react';
import { useChats } from '@/ui-desks/chats/context';
import type { WidgetCustomDropIntent } from '@/ui-desks/connectors/use-connector-interactions';
import type { WidgetCustomDropAction } from '@/ui-desks/widgets/types';
import type { Editor } from 'tldraw';

interface UseWidgetCustomDropActionsOptions {
	editor: Editor | null;
	intent: WidgetCustomDropIntent | null;
	closeMenu: () => void;
}

export function useWidgetCustomDropActions( {
	editor,
	intent,
	closeMenu,
}: UseWidgetCustomDropActionsOptions ): WidgetCustomDropAction[] {
	const registry = useRegistry();
	const { startChatWithPrompt } = useChats();
	const { saveEntityRecord } = useDispatch( coreDataStore );
	const runAction = useCallback(
		( action: () => void | Promise< unknown > ) => {
			closeMenu();
			let result: void | Promise< unknown >;
			try {
				result = action();
			} catch ( error ) {
				console.warn( 'Failed to handle widget drop action.', error );
				return;
			}
			void Promise.resolve( result ).catch( ( error ) => {
				console.warn( 'Failed to handle widget drop action.', error );
			} );
		},
		[ closeMenu ]
	);

	return useMemo( () => {
		if ( ! editor || ! intent || ! intent.handler.getActions ) {
			return [];
		}

		return intent.handler.getActions( intent, {
			editor,
			registry,
			runAction,
			saveEntityRecord,
			startChatWithPrompt,
		} );
	}, [ editor, intent, registry, runAction, saveEntityRecord, startChatWithPrompt ] );
}
