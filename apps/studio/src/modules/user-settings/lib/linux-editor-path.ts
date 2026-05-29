import { findOnPath } from 'src/lib/find-on-path';
import { SupportedEditor, supportedEditorConfig } from 'src/modules/user-settings/lib/editor';

/**
 * Finds the executable path for a given editor on Linux by walking $PATH.
 */
export async function linuxFindEditorPath( editorKey: SupportedEditor ): Promise< string | null > {
	const editor = supportedEditorConfig[ editorKey ];
	if ( ! editor?.linuxCommands?.length ) {
		return null;
	}

	for ( const command of editor.linuxCommands ) {
		const found = findOnPath( command );
		if ( found ) {
			return found;
		}
	}

	return null;
}
