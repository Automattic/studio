import { widgetDefinitions } from './registry';
import { normalizeHttpUrl } from './url';
import type {
	DeskWidget,
	DeskWidgetDefinition,
	WidgetPasteAccept,
	WidgetPasteHandler,
	WidgetPastePayload,
} from './types';

interface GetWidgetPasteHandlerOptions {
	isRunningSite?: boolean;
	siteId?: string;
}

interface WidgetPasteHandlerMatch {
	definition: DeskWidgetDefinition;
	handler: WidgetPasteHandler< DeskWidget >;
}

export function getWidgetPasteHandler(
	payload: WidgetPastePayload,
	options: GetWidgetPasteHandlerOptions = {}
): WidgetPasteHandlerMatch | null {
	const context = {
		siteId: options.siteId,
	};

	for ( const definition of Object.values( widgetDefinitions ) as DeskWidgetDefinition[] ) {
		for ( const handler of definition.pasteHandlers ?? [] ) {
			if ( handler.requiresRunningSite && ! options.isRunningSite ) {
				continue;
			}

			if ( doesPasteMatchAccept( payload, handler.accept ) ) {
				if ( handler.canHandle && ! handler.canHandle( payload, context ) ) {
					continue;
				}

				return {
					definition,
					handler: handler as WidgetPasteHandler< DeskWidget >,
				};
			}
		}
	}

	return null;
}

export function createUrlPastePayload( text: string ): WidgetPastePayload | null {
	const trimmedText = text.trim();
	const url = normalizeHttpUrl( trimmedText );
	if ( ! url ) {
		return null;
	}

	return {
		kind: 'url',
		text: trimmedText,
		url,
	};
}

export function doesPasteMatchAccept( payload: WidgetPastePayload, accept: WidgetPasteAccept ) {
	if ( accept.kinds && ! accept.kinds.includes( payload.kind ) ) {
		return false;
	}

	if ( payload.kind === 'url' && accept.protocols?.length ) {
		return doesUrlProtocolMatchAccept( payload.url, accept.protocols );
	}

	return true;
}

function doesUrlProtocolMatchAccept( url: string, acceptedProtocols: string[] ) {
	try {
		const protocol = new URL( url ).protocol.toLowerCase();
		return acceptedProtocols.some( ( acceptedProtocol ) => {
			const normalizedAcceptedProtocol = acceptedProtocol.toLowerCase();
			return (
				protocol ===
				( normalizedAcceptedProtocol.endsWith( ':' )
					? normalizedAcceptedProtocol
					: `${ normalizedAcceptedProtocol }:` )
			);
		} );
	} catch {
		return false;
	}
}
