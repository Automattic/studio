import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { cx } from 'src/lib/cx';
import type { ToolCallDisplay } from 'src/stores/agent-chat-slice';

const TOOL_LABELS: Record< string, string > = {
	execute_wp_cli: 'WP-CLI',
	create_site: 'Create Site',
	manage_site: 'Manage Site',
	get_sites: 'Get Sites',
	explore_file_tree: 'File Explorer',
	get_theme_details: 'Theme Details',
	validate_blueprint: 'Validate Blueprint',
	update_site: 'Update Site',
	search_support_docs: 'Search Docs',
};

interface AgentToolResultProps {
	toolCall: ToolCallDisplay;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
}

export function AgentToolResult( {
	toolCall,
	isExpanded = false,
	onToggleExpand,
}: AgentToolResultProps ) {
	const { __ } = useI18n();
	const { name, input, result, executedAt: _executedAt } = toolCall;

	const label = TOOL_LABELS[ name ] || name;
	const isSuccess = result?.success ?? true;
	const isLoading = ! result;

	return (
		<div
			className={ cx(
				'rounded-md border my-2 overflow-hidden',
				isSuccess ? 'border-gray-200' : 'border-a8c-red-5'
			) }
		>
			{ /* Header */ }
			<button
				onClick={ onToggleExpand }
				className={ cx(
					'w-full flex items-center gap-2 px-3 py-2 text-left',
					'hover:bg-gray-50 transition-colors',
					isLoading && 'animate-pulse bg-gray-50'
				) }
			>
				{ /* Status indicator */ }
				<div
					className={ cx(
						'w-2 h-2 rounded-full flex-shrink-0',
						isLoading && 'bg-a8c-blue-50 animate-pulse',
						! isLoading && isSuccess && 'bg-green-500',
						! isLoading && ! isSuccess && 'bg-a8c-red-50'
					) }
				/>

				{ /* Tool name */ }
				<span className="font-medium text-sm flex-grow">{ label }</span>

				{ /* Expand/collapse icon */ }
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					className={ cx(
						'w-4 h-4 text-gray-400 transition-transform',
						isExpanded && 'rotate-180'
					) }
				>
					<path
						fillRule="evenodd"
						d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
						clipRule="evenodd"
					/>
				</svg>
			</button>

			{ /* Expanded content */ }
			{ isExpanded && (
				<div className="border-t border-gray-200 bg-gray-50">
					{ /* Input */ }
					{ Object.keys( input ).length > 0 && (
						<div className="p-3 border-b border-gray-200">
							<p className="text-xs font-medium text-gray-500 mb-1">{ __( 'Input' ) }</p>
							<pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">
								{ JSON.stringify( input, null, 2 ) }
							</pre>
						</div>
					) }

					{ /* Result */ }
					{ result && (
						<div className="p-3">
							<p className="text-xs font-medium text-gray-500 mb-1">
								{ result.success ? __( 'Output' ) : __( 'Error' ) }
							</p>
							<pre
								className={ cx(
									'text-xs p-2 rounded border overflow-x-auto whitespace-pre-wrap',
									result.success
										? 'bg-white border-gray-200'
										: 'bg-a8c-red-5 border-a8c-red-10 text-a8c-red-70'
								) }
							>
								{ result.success ? result.output : result.error }
							</pre>
						</div>
					) }

					{ /* Loading state */ }
					{ isLoading && (
						<div className="p-3 text-sm text-gray-500 flex items-center gap-2">
							<svg
								className="animate-spin h-4 w-4"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								/>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								/>
							</svg>
							{ __( 'Executing...' ) }
						</div>
					) }
				</div>
			) }
		</div>
	);
}

interface AgentToolResultsListProps {
	toolCalls: ToolCallDisplay[];
}

export function AgentToolResultsList( { toolCalls }: AgentToolResultsListProps ) {
	const [ expandedIds, setExpandedIds ] = useState< Set< string > >( new Set() );

	const toggleExpand = ( id: string ) => {
		setExpandedIds( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			return next;
		} );
	};

	if ( toolCalls.length === 0 ) {
		return null;
	}

	return (
		<div className="mt-2">
			{ toolCalls.map( ( toolCall ) => (
				<AgentToolResult
					key={ toolCall.id }
					toolCall={ toolCall }
					isExpanded={ expandedIds.has( toolCall.id ) }
					onToggleExpand={ () => toggleExpand( toolCall.id ) }
				/>
			) ) }
		</div>
	);
}
