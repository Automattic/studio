import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
	Theme,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { stripMediaWidgetPayloadLines } from '@studio/common/ai/chat-artifacts';
import { getStudioToolProgress } from '@studio/common/ai/tool-progress';
import { getToolDetail, getToolDisplayName } from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { Type } from 'typebox';
import { theme } from 'cli/ai/theme';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	formatToolOutputLines,
	renderGenericToolResult,
	toolResultRenderers,
} from './tool-result-renderers';

interface StudioRenderState {
	progressLines: string[];
}

const PROGRESS_PREVIEW_LINES = 4;

function renderProgressBlock( lines: string[], expanded: boolean ): string {
	if ( ! lines.length ) {
		return '';
	}
	let shown = lines;
	const hidden = lines.length - PROGRESS_PREVIEW_LINES;
	const display: string[] = [];
	if ( ! expanded && hidden > 0 ) {
		shown = lines.slice( -PROGRESS_PREVIEW_LINES );
		display.push(
			sprintf(
				/* translators: %d: number of hidden progress lines */
				__( '... (%d earlier lines · ctrl+o to expand)' ),
				hidden
			)
		);
	}
	display.push( ...shown );
	return formatToolOutputLines( display.map( ( l ) => theme.fg( 'muted', l ) ) );
}

function textContent( content: Array< { type: string; text?: string } > ): string {
	return stripMediaWidgetPayloadLines(
		content
			.filter( ( block ) => block.type === 'text' && block.text )
			.map( ( block ) => block.text )
			.join( '\n' )
	);
}

function renderStudioCall( name: string ) {
	return ( args: Record< string, unknown >, theme: Theme ) => {
		const displayName = theme.fg( 'toolTitle', theme.bold( getToolDisplayName( name, args ) ) );
		const detail = getToolDetail( name, args );
		return new Text(
			detail ? `${ displayName } ${ theme.fg( 'muted', detail ) }` : displayName,
			0,
			0
		);
	};
}

function renderStudioResult( name: string ) {
	return (
		result: {
			content: Array< { type: string; text?: string } >;
			details?: unknown;
			isError: boolean;
		},
		options: { expanded: boolean; isPartial: boolean },
		_theme: Theme,
		context: { args: Record< string, unknown >; state: StudioRenderState }
	) => {
		const state = context.state;
		state.progressLines ??= [];

		if ( options.isPartial ) {
			const progress = getStudioToolProgress( result );
			if ( progress ) {
				const last = state.progressLines[ state.progressLines.length - 1 ];
				if ( progress.update && state.progressLines.length > 0 ) {
					state.progressLines[ state.progressLines.length - 1 ] = progress.message;
				} else if ( last !== progress.message ) {
					state.progressLines.push( progress.message );
				}
			}
			return new Text( renderProgressBlock( state.progressLines, options.expanded ), 0, 0 );
		}

		const text = textContent( result.content );
		const isError = result.isError === true;
		const renderer = toolResultRenderers[ name ];
		const rendered =
			renderer?.(
				{ input: context.args, text, isError, details: result.details },
				options.expanded
			) ?? ( text ? renderGenericToolResult( text, options.expanded ) : null );

		const progress = renderProgressBlock( state.progressLines, options.expanded );
		return new Text( [ progress, rendered ?? '' ].filter( Boolean ).join( '\n' ), 0, 0 );
	};
}

function studioRenderDefinition( name: string ): ToolDefinition {
	return {
		name,
		label: name,
		description: '',
		parameters: Type.Object( {} ),
		async execute() {
			throw new Error( `${ name } render definition is display-only` );
		},
		renderCall: renderStudioCall( name ) as ToolDefinition[ 'renderCall' ],
		renderResult:
			name === 'AskUserQuestion'
				? () => new Text( '', 0, 0 )
				: ( renderStudioResult( name ) as unknown as ToolDefinition[ 'renderResult' ] ),
	};
}

// pi's coding tools keep pi's renderers; Studio tools render through the
// registry in tool-result-renderers.ts. Keyed by Studio's registered names.
let definitions: Map< string, ToolDefinition > | null = null;

export function getToolRenderDefinition( name: string ): ToolDefinition | undefined {
	if ( ! definitions ) {
		const root = STUDIO_SITES_ROOT;
		definitions = new Map< string, ToolDefinition >( [
			[ 'Read', createReadToolDefinition( root ) as ToolDefinition ],
			[ 'Write', createWriteToolDefinition( root ) as ToolDefinition ],
			[ 'Edit', createEditToolDefinition( root ) as ToolDefinition ],
			[ 'Bash', createBashToolDefinition( root ) as ToolDefinition ],
			[ 'Grep', createGrepToolDefinition( root ) as ToolDefinition ],
			[ 'Glob', createFindToolDefinition( root ) as ToolDefinition ],
			[ 'Ls', createLsToolDefinition( root ) as ToolDefinition ],
		] );
	}
	let definition = definitions.get( name );
	if ( ! definition ) {
		definition = studioRenderDefinition( name );
		definitions.set( name, definition );
	}
	return definition;
}
