import { __ } from '@wordpress/i18n';
import {
	ChartNoAxesCombinedIcon,
	GaugeIcon,
	GlobeIcon,
	PaperclipIcon,
	PencilRulerIcon,
	PlayIcon,
	SlidersHorizontalIcon,
	SparklesIcon,
	TagsIcon,
	UnlockIcon,
} from 'lucide-react';
import { McpIcon, StartSiteIcon } from '@/lib/icons';
import type { Command, CommandGroup } from '@/lib/ui';
import type { SkillSlashCommand } from '@studio/common/ai/slash-commands';
import type { ComponentType } from 'react';

const COMMAND_ICONS: Partial< Record< string, ComponentType< { className?: string } > > > = {
	annotate: PencilRulerIcon,
	taxonomist: TagsIcon,
	'need-for-speed': GaugeIcon,
	'rank-me-up': ChartNoAxesCombinedIcon,
	liberate: UnlockIcon,
	'auto-start': StartSiteIcon,
	'connect-provider': McpIcon,
	model: SlidersHorizontalIcon,
	live: GlobeIcon,
	local: PlayIcon,
};

// The composer's own actions, offered next to the skills.
export function getComposerCommands( {
	canAutoStart,
	autoStartOn,
	canChooseModel,
	environment,
	liveUrl,
	canChangeEnvironment,
}: {
	canAutoStart: boolean;
	autoStartOn: boolean;
	canChooseModel: boolean;
	environment: 'local' | 'live';
	liveUrl?: string;
	canChangeEnvironment: boolean;
} ): SkillSlashCommand[] {
	return [
		...( canAutoStart && ! autoStartOn
			? [
					{
						name: 'auto-start',
						displayName: __( 'Auto-start' ),
						description: __( 'Start stopped sites when you send a chat message.' ),
					},
			  ]
			: [] ),
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
			displayName: __( 'Connect AI providers' ),
			description: __( 'Use WordPress.com AI credits or your own API key.' ),
		},
		...( canChangeEnvironment && environment === 'local' && liveUrl
			? [ { name: 'live', displayName: __( 'Work on live site' ), description: liveUrl } ]
			: [] ),
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
			items: [
				...( addOpen
					? [ { value: 'add-files', label: __( 'Add files' ), icon: PaperclipIcon } ]
					: [] ),
				...( addOpen ? commands : matches.filter( ( command ) => ! isSkill( command ) ) ).map(
					toCommand
				),
			],
		},
		{
			label: __( 'Skills' ),
			heading: __( 'Skills' ),
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
