import { getInputString, getToolDetail, getToolDisplayName } from '@studio/agent/protocol/tools';
import {
	AnnotateIcon,
	AttachmentIcon,
	ChatIcon,
	ChecklistIcon,
	CloudDownloadIcon,
	CloudUploadIcon,
	CodeIcon,
	FileImageIcon,
	FolderOpenIcon,
	GaugeIcon,
	GlobeIcon,
	PaletteIcon,
	PencilIcon,
	RotateCwIcon,
	SearchIcon,
	SkillsIcon,
	SquarePenIcon,
	TerminalIcon,
	WordPressIcon,
} from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { createElement, type ComponentProps, type ComponentType } from 'react';

const TOOL_DETAIL_MAX_LENGTH = 96;

const TOOL_ICONS: Record< string, ComponentType< ComponentProps< 'svg' > > > = {
	Read: () => createElement( AttachmentIcon, { kind: 'file' } ),
	Write: SquarePenIcon,
	Edit: PencilIcon,
	Bash: TerminalIcon,
	Glob: SearchIcon,
	Grep: SearchIcon,
	Ls: FolderOpenIcon,
	Skill: SkillsIcon,
	wp_cli: TerminalIcon,
	wpcom_request: WordPressIcon,
	site_create: GlobeIcon,
	site_list: GlobeIcon,
	site_info: GlobeIcon,
	site_start: GlobeIcon,
	site_stop: GlobeIcon,
	site_delete: GlobeIcon,
	site_connected_remote_sites: GlobeIcon,
	site_push: CloudUploadIcon,
	site_pull: CloudDownloadIcon,
	site_import: CloudDownloadIcon,
	site_export: CloudUploadIcon,
	preview_create: GlobeIcon,
	preview_list: GlobeIcon,
	preview_update: RotateCwIcon,
	preview_delete: GlobeIcon,
	refresh_browser: RotateCwIcon,
	scaffold_theme: CodeIcon,
	pick_design: PaletteIcon,
	present_design_options: PaletteIcon,
	inspect_design: PaletteIcon,
	validate_blocks: CodeIcon,
	take_screenshot: FileImageIcon,
	generate_images: FileImageIcon,
	open_annotation_browser: AnnotateIcon,
	need_for_speed: GaugeIcon,
	rank_me_up: SearchIcon,
	send_feedback: ChatIcon,
	AskUserQuestion: ChatIcon,
	TodoWrite: ChecklistIcon,
};

interface ToolDisplay {
	label: string;
	detail: string;
	inputText: string;
	Icon: ComponentType< ComponentProps< 'svg' > >;
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

	// The row's title already names the skill.
	if ( name === 'Skill' ) {
		return '';
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
		Icon: TOOL_ICONS[ name ] ?? CodeIcon,
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
