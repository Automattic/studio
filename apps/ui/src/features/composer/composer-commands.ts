import { __ } from '@wordpress/i18n';
import {
	ChartNoAxesCombinedIcon,
	GaugeIcon,
	LayoutDashboardIcon,
	PaperclipIcon,
	PencilRulerIcon,
	PlayIcon,
	SlidersHorizontalIcon,
	SparklesIcon,
	TagsIcon,
	UnlockIcon,
} from 'lucide-react';
import { McpIcon, SplitViewIcon, StartSiteIcon, StopSiteIcon } from '@/lib/icons';
import type { Command, CommandGroup } from '@/lib/ui';
import type { SkillSlashCommand } from '@studio/agent/protocol/slash-commands';
import type { ComponentType } from 'react';

const COMMAND_ICONS: Partial< Record< string, ComponentType< { className?: string } > > > = {
	'add-files': PaperclipIcon,
	start: StartSiteIcon,
	stop: StopSiteIcon,
	annotate: PencilRulerIcon,
	taxonomist: TagsIcon,
	'need-for-speed': GaugeIcon,
	'rank-me-up': ChartNoAxesCombinedIcon,
	liberate: UnlockIcon,
	'curate-admin': LayoutDashboardIcon,
	'auto-start': StartSiteIcon,
	panel: SplitViewIcon,
	'connect-provider': McpIcon,
	model: SlidersHorizontalIcon,
	local: PlayIcon,
};

// The composer's own actions, offered next to the skills.
export function getComposerCommands( {
	canAutoStart,
	autoStartOn,
	canChooseModel,
	environment,
	canChangeEnvironment,
	panelCommand,
	siteCommand,
}: {
	canAutoStart: boolean;
	autoStartOn: boolean;
	canChooseModel: boolean;
	environment: 'local' | 'live';
	canChangeEnvironment: boolean;
	panelCommand?: SkillSlashCommand;
	siteCommand?: 'start' | 'stop';
} ): SkillSlashCommand[] {
	return [
		{
			name: 'add-files',
			displayName: __( 'Add files' ),
			description: '',
		},
		...( siteCommand
			? [
					{
						name: siteCommand,
						displayName: siteCommand === 'start' ? __( 'Start site' ) : __( 'Stop site' ),
						description: siteCommand === 'start' ? __( 'Start this site.' ) : '',
					},
			  ]
			: [] ),
		...( canAutoStart && ! autoStartOn
			? [
					{
						name: 'auto-start',
						displayName: __( 'Auto-start' ),
						description: __( 'Start stopped sites when you send a chat message.' ),
					},
			  ]
			: [] ),
		...( panelCommand ? [ panelCommand ] : [] ),
		...( canChooseModel
			? [
					{
						name: 'model',
						displayName: __( 'Choose model' ),
						description: __( 'Select a model for this chat.' ),
					},
			  ]
			: [] ),
		{
			name: 'connect-provider',
			displayName: __( 'Connect providers' ),
			description: __( 'Use WordPress.com AI credits or your own API key.' ),
		},
		...( canChangeEnvironment && environment === 'live'
			? [
					{
						name: 'local',
						displayName: __( 'Work on local site' ),
						description: __( 'Work on the local site on your computer.' ),
					},
			  ]
			: [] ),
	];
}

// The add menu lists everything; a `/fragment` lists its matches.
export function getCommandGroups( {
	addOpen,
	commands,
	skills,
	matches,
	isDisabled,
}: {
	addOpen: boolean;
	commands: SkillSlashCommand[];
	skills: SkillSlashCommand[];
	matches: SkillSlashCommand[];
	isDisabled: ( name: string ) => boolean;
} ): CommandGroup[] {
	const isSkill = ( command: SkillSlashCommand ) =>
		skills.some( ( skill ) => skill.name === command.name );
	const toCommand = ( command: SkillSlashCommand ): Command => ( {
		value: command.name,
		label: command.displayName ?? command.name,
		description: command.description,
		icon: COMMAND_ICONS[ command.name ] ?? SparklesIcon,
		disabled: isDisabled( command.name ),
	} );
	return [
		{
			label: __( 'Commands' ),
			items: ( addOpen ? commands : matches.filter( ( command ) => ! isSkill( command ) ) ).map(
				toCommand
			),
		},
		{
			label: __( 'Skills' ),
			heading: addOpen ? __( 'Skills' ) : undefined,
			items: ( addOpen ? skills : matches.filter( isSkill ) ).map( toCommand ),
		},
	];
}

// The draft once a command replaces the `/fragment` before the cursor, and
// where the cursor goes; null when an action leaves the draft as it is.
export function applyCommandToDraft(
	value: string,
	selectionStart: number,
	selectionEnd: number,
	name: string,
	isSkill: boolean
): { text: string; cursor: number } | null {
	const before = value.slice( 0, selectionStart );
	const after = value.slice( selectionEnd );
	const fragment = /(?:^|\s)(\/[\w-]*)$/.exec( before );
	const prefix = fragment ? before.slice( 0, -fragment[ 1 ].length ) : before;
	if ( isSkill ) {
		const command = `${ prefix && ! /\s$/.test( prefix ) ? ' ' : '' }/${ name }${
			/^\s/.test( after ) ? '' : ' '
		}`;
		return {
			text: prefix + command + after,
			cursor: prefix.length + command.length + ( /^\s/.test( after ) ? 1 : 0 ),
		};
	}
	return fragment ? { text: prefix + after, cursor: prefix.length } : null;
}
