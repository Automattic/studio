import { __ } from '@wordpress/i18n';
import { chevronDown, chevronRight, Icon } from '@wordpress/icons';
import { useState } from 'react';
import { cx } from 'src/lib/cx';
import type { ToolCallState } from './studio-code-types';

function formatToolName( name: string ): string {
	// Convert "mcp__studio__site_create" → "Site Create"
	const parts = name.split( '__' );
	const lastPart = parts[ parts.length - 1 ];
	return lastPart
		.split( '_' )
		.map( ( word ) => word.charAt( 0 ).toUpperCase() + word.slice( 1 ) )
		.join( ' ' );
}

function StatusIcon( { status }: { status: ToolCallState[ 'status' ] } ) {
	switch ( status ) {
		case 'running':
			return <span className="text-yellow-500">{ '\u23F3' }</span>;
		case 'completed':
			return <span className="text-green-600">{ '\u2713' }</span>;
		case 'error':
			return <span className="text-red-600">{ '\u2717' }</span>;
	}
}

function statusLabel( status: ToolCallState[ 'status' ] ): string {
	switch ( status ) {
		case 'running':
			return __( 'Running' );
		case 'completed':
			return __( 'Completed' );
		case 'error':
			return __( 'Error' );
	}
}

interface StudioCodeToolCallProps {
	toolCall: ToolCallState;
}

export function StudioCodeToolCall( { toolCall }: StudioCodeToolCallProps ) {
	const [ isExpanded, setIsExpanded ] = useState( false );

	return (
		<div className="my-1 border border-frame-border rounded text-xs">
			<button
				type="button"
				className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left bg-transparent border-none cursor-pointer hover:bg-frame/50"
				onClick={ () => setIsExpanded( ! isExpanded ) }
			>
				<Icon icon={ isExpanded ? chevronDown : chevronRight } size={ 16 } />
				<StatusIcon status={ toolCall.status } />
				<span className="font-medium">{ formatToolName( toolCall.name ) }</span>
				<span className="text-frame-text-secondary ml-auto">
					{ statusLabel( toolCall.status ) }
				</span>
			</button>
			{ isExpanded && (
				<div className="px-2 pb-2 border-t border-frame-border">
					<div className="mt-1.5">
						<div className="text-frame-text-secondary mb-0.5">{ __( 'Input:' ) }</div>
						<pre
							className={ cx(
								'bg-frame p-1.5 rounded text-[11px] overflow-x-auto whitespace-pre-wrap'
							) }
						>
							{ JSON.stringify( toolCall.input, null, 2 ) }
						</pre>
					</div>
					{ toolCall.output !== undefined && (
						<div className="mt-1.5">
							<div className="text-frame-text-secondary mb-0.5">{ __( 'Output:' ) }</div>
							<pre
								className={ cx(
									'p-1.5 rounded text-[11px] overflow-x-auto whitespace-pre-wrap',
									toolCall.isError ? 'bg-frame-error/10' : 'bg-frame'
								) }
							>
								{ toolCall.output }
							</pre>
						</div>
					) }
				</div>
			) }
		</div>
	);
}
