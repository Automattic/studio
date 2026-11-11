import { getInputString, getToolDetail, getToolDisplayName } from '@studio/agent/protocol/tools';
import { __ } from '@wordpress/i18n';

const TOOL_DETAIL_MAX_LENGTH = 96;

interface ToolDisplay {
	label: string;
	detail: string;
	inputText: string;
}

function truncateToolDetail( value: string, maxLength = TOOL_DETAIL_MAX_LENGTH ): string {
	if ( value.length <= maxLength ) {
		return value;
	}
	return value.slice( 0, maxLength - 1 ).trimEnd() + '…';
}

function stringifyToolInput( input: Record< string, unknown > ): string {
	try {
		return JSON.stringify( input, null, 2 );
	} catch {
		return String( input );
	}
}

function getToolInputText( name: string, input: Record< string, unknown > | undefined ): string {
	if ( ! input || Object.keys( input ).length === 0 ) {
		return '';
	}

	if ( name === 'wp_cli' ) {
		const command = getInputString( input, 'command' );
		return command ? `wp ${ command }` : '';
	}

	if ( name === 'Bash' ) {
		return getInputString( input, 'command' );
	}

	return stringifyToolInput( input );
}

export function getToolDisplay(
	name: string,
	input: Record< string, unknown > | undefined
): ToolDisplay {
	const genericDetail = getToolDetail( name, input );
	const display: ToolDisplay = {
		label: getToolDisplayName( name, input ),
		detail: genericDetail,
		inputText: getToolInputText( name, input ),
	};

	switch ( name ) {
		case 'wp_cli':
			display.detail = '';
			break;
		case 'Bash':
			display.label = __( 'Run terminal command' );
			display.detail = '';
			break;
		case 'take_screenshot':
		case 'inspect_design':
		case 'open_annotation_browser':
			display.detail = '';
			break;
	}

	display.detail = truncateToolDetail( display.detail );
	return display;
}
