/**
 * Thrown by connector methods that have no meaning in a browser (native file
 * dialogs, opening an editor/terminal, etc.). Callers in the UI already wrap
 * these affordances in try/catch, so throwing keeps the surface honest without
 * breaking the app. Shared by the `hosted` and `local` browser connectors.
 */
export class UnsupportedError extends Error {
	constructor( operation: string ) {
		super( `"${ operation }" is not available in this Studio environment.` );
		this.name = 'UnsupportedError';
	}
}
