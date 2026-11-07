import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import {
	addTextEdit,
	canPickAnnotation,
	changeAnnotation,
	closeAnnotationEditor,
	type AnnotationAnchor,
} from '@/features/annotations';
import type { usePreviewAnnotations } from './use-preview-annotations';
import type { InspectorAction, InspectorEvent } from '@studio/agent/protocol/inspector/page-script';
import type { InspectorTextEdit } from '@studio/agent/protocol/inspector/text-edit';

type TextEvent = Extract< InspectorEvent, { type: 'text-edit' } >;

export function useTextAnnotations( {
	siteId,
	enabled,
	onPick,
	onSend,
	command,
	toViewportAnchor,
}: {
	siteId: string;
	enabled: boolean;
	onPick: ReturnType< typeof usePreviewAnnotations >[ 'handleAnnotationPick' ];
	onSend: ( ids: string[] ) => void;
	command: ( type: InspectorAction[ 'type' ] ) => void;
	toViewportAnchor: ( anchor: AnnotationAnchor | null ) => AnnotationAnchor | null;
} ) {
	const [ draft, setDraft ] = useState< {
		edit: InspectorTextEdit;
		anchor: AnnotationAnchor | null;
	} | null >( null );
	const send = useCallback(
		( edit: InspectorTextEdit, noteIds: string[] ) => {
			if ( ! enabled || edit.text === edit.originalText ) return;
			const id = onPick( edit.target, { left: 0, top: 0 } );
			if ( ! id ) return;
			changeAnnotation( siteId, id, {
				comment: sprintf(
					/* translators: 1: original text, 2: replacement text. */
					__( 'Change the text from “%1$s” to “%2$s”.' ),
					edit.originalText,
					edit.text
				),
			} );
			closeAnnotationEditor( siteId );
			addTextEdit( siteId, { ...edit, id, pending: true } );
			command( 'commit-text' );
			setDraft( null );
			onSend( [ ...noteIds, id ] );
		},
		[ command, enabled, onPick, onSend, siteId ]
	);
	const cancel = useCallback( () => {
		command( 'cancel-text' );
		setDraft( null );
	}, [ command ] );
	const handleEvent = useCallback(
		( event: TextEvent ) => {
			if ( ! event.edit ) {
				setDraft( null );
			} else if ( ! enabled ) {
				return;
			} else if ( canPickAnnotation( siteId ) ) {
				setDraft( { edit: event.edit, anchor: toViewportAnchor( event.anchor ) } );
			} else {
				cancel();
			}
		},
		[ cancel, enabled, siteId, toViewportAnchor ]
	);
	return {
		draft,
		handleEvent,
		cancel,
		send: ( noteIds: string[] = [] ) => {
			if ( draft ) send( draft.edit, noteIds );
		},
		escapeDraft: () => {
			if ( ! draft ) return false;
			cancel();
			return true;
		},
	};
}
