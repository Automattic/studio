import path from 'node:path';
import { createSiteSkill } from '@studio/common/lib/agent-skills';
import { createGlobalSkill } from '@studio/common/lib/global-skills';
import { getGlobalSkillsDirectory } from '@studio/common/lib/well-known-paths';
import { Type } from 'typebox';
import { RESERVED_SKILL_NAMES } from '@studio/agent/protocol/reserved-skill-names';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const saveSkillTool = defineTool(
	'save_skill',
	"Saves a new skill of the user's own: a folder with a SKILL.md that agents load later by its description, or when the user types `/` and its name. It never changes a skill that exists: when the name is taken it fails, so pick another name. To change a skill that exists, edit its SKILL.md. Keep `instructions` under 12,000 characters.",
	{
		scope: Type.Enum( [ 'site', 'all_sites' ], {
			description:
				"`site` saves the skill in one site's folder, so it works only there and moves with the site. `all_sites` saves it in Studio, so it works on every site.",
		} ),
		nameOrPath: Type.Optional(
			Type.String( {
				description: 'The site name or file system path to the site. Required for `site`.',
			} )
		),
		name: Type.String( {
			description:
				'Two to four words that say the task, such as "Lookbook post". The command comes from it: `/lookbook-post`.',
		} ),
		description: Type.String( {
			description:
				'One or two sentences: what the skill does and when to use it, in the words the user would ask with. Agents pick the skill by this text alone.',
		} ),
		instructions: Type.String( {
			description:
				'The steps to follow, in Markdown, for an agent that has not seen this conversation.',
		} ),
	},
	async ( args, context ) => {
		const draft = {
			name: args.name,
			description: args.description,
			instructions: args.instructions,
		};
		// Settings is part of the Studio app: a chat in a terminal has only the file.
		const saved = ( where: string, id: string, directory: string ) =>
			textResult(
				`Saved the skill ${ where } in ${ directory }. The user runs it with /${ id } from their next message, and changes it ${
					context.host.ui
						? 'in Settings → Skills'
						: `by editing ${ path.join( directory, 'SKILL.md' ) }`
				}.`
			);
		if ( args.scope === 'all_sites' ) {
			const id = await createGlobalSkill( draft, RESERVED_SKILL_NAMES );
			return saved( 'for all sites', id, path.join( getGlobalSkillsDirectory(), id ) );
		}
		if ( ! args.nameOrPath ) {
			throw new Error( 'Name the site to save the skill in, or use the `all_sites` scope.' );
		}
		const site = await context.host.sites.resolve( args.nameOrPath );
		const id = await createSiteSkill( site.path, draft, RESERVED_SKILL_NAMES );
		return saved( `on ${ site.name }`, id, path.join( site.path, '.agents', 'skills', id ) );
	},
	{ annotations: LOCAL_CHANGE }
);
