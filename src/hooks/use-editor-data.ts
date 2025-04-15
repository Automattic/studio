import { useState, useEffect } from 'react';
import { SupportedEditor, DEFAULT_EDITOR } from 'src/lib/editor';
import { getIpcApi } from 'src/lib/get-ipc-api';

/**
 * Hook to manage editor preferences
 */
export function useEditorData() {
	const [ editor, setEditor ] = useState< SupportedEditor >( DEFAULT_EDITOR );
	const [ savedEditorValue, setSavedEditorValue ] = useState< SupportedEditor >( DEFAULT_EDITOR );

	// Get the saved editor from the API
	const getSavedEditor = async () => {
		try {
			const savedEditor = await getIpcApi().getUserEditor();
			return savedEditor || DEFAULT_EDITOR;
		} catch ( error ) {
			return DEFAULT_EDITOR;
		}
	};

	// Load the saved editor value
	useEffect( () => {
		const loadSavedEditor = async () => {
			const editor = await getSavedEditor();
			setSavedEditorValue( editor );
			setEditor( editor );
		};
		loadSavedEditor();
	}, [] );

	// Handle editor change
	const handleEditorChange = ( newEditor: SupportedEditor ) => {
		setEditor( newEditor );
	};

	// Save editor preference
	const saveEditorPreference = async () => {
		await getIpcApi().saveUserEditor( editor );
	};

	// Reset editor to saved value
	const resetEditor = () => {
		setEditor( savedEditorValue );
	};

	// Check if editor has changes
	const hasEditorChanges = editor !== savedEditorValue;

	return {
		editor,
		savedEditorValue,
		handleEditorChange,
		saveEditorPreference,
		resetEditor,
		hasEditorChanges,
	};
}
