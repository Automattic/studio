import { widgetDefinitions } from './registry';
import type {
	DeskWidget,
	DeskWidgetDefinition,
	WidgetFileAccept,
	WidgetFileHandler,
} from './types';

interface GetWidgetFileHandlerOptions {
	isRunningSite?: boolean;
}

interface WidgetFileHandlerMatch {
	definition: DeskWidgetDefinition;
	handler: WidgetFileHandler< DeskWidget >;
}

export function getWidgetFileHandler(
	file: File,
	options: GetWidgetFileHandlerOptions = {}
): WidgetFileHandlerMatch | null {
	for ( const definition of Object.values( widgetDefinitions ) as DeskWidgetDefinition[] ) {
		for ( const handler of definition.fileHandlers ?? [] ) {
			if ( handler.requiresRunningSite && ! options.isRunningSite ) {
				continue;
			}

			if ( doesFileMatchAccept( file, handler.accept ) ) {
				return {
					definition,
					handler: handler as WidgetFileHandler< DeskWidget >,
				};
			}
		}
	}

	return null;
}

export function doesFileMatchAccept( file: File, accept: WidgetFileAccept ) {
	return (
		doesMimeTypeMatchAccept( file.type, accept.mimeTypes ) ||
		doesExtensionMatchAccept( file.name, accept.extensions )
	);
}

function doesMimeTypeMatchAccept( mimeType: string, acceptedMimeTypes: string[] = [] ) {
	if ( ! mimeType ) {
		return false;
	}

	const normalizedMimeType = mimeType.toLowerCase();
	return acceptedMimeTypes.some( ( acceptedMimeType ) => {
		const normalizedAcceptedMimeType = acceptedMimeType.toLowerCase();
		if ( normalizedAcceptedMimeType.endsWith( '/*' ) ) {
			return normalizedMimeType.startsWith( normalizedAcceptedMimeType.slice( 0, -1 ) );
		}

		return normalizedMimeType === normalizedAcceptedMimeType;
	} );
}

function doesExtensionMatchAccept( filename: string, acceptedExtensions: string[] = [] ) {
	const normalizedFilename = filename.toLowerCase();
	return acceptedExtensions.some( ( extension ) =>
		normalizedFilename.endsWith( normalizeExtension( extension ) )
	);
}

function normalizeExtension( extension: string ) {
	const normalizedExtension = extension.toLowerCase();
	return normalizedExtension.startsWith( '.' ) ? normalizedExtension : `.${ normalizedExtension }`;
}
