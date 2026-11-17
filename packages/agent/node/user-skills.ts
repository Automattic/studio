import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSkillFile, type Skill } from '@studio/agent/shared/skills';

// The user's own skills, in ~/.agents/skills: the folder agents share for skills
// across projects. Read on each call, so a skill added between turns is there.
export function readUserSkills( root = path.join( os.homedir(), '.agents', 'skills' ) ): Skill[] {
	if ( ! fs.existsSync( root ) ) {
		return [];
	}
	return fs.readdirSync( root, { withFileTypes: true } ).flatMap( ( entry ) => {
		const folder = path.join( root, entry.name );
		const skillPath = path.join( folder, 'SKILL.md' );
		if ( ! entry.isDirectory() || ! fs.existsSync( skillPath ) ) {
			return [];
		}
		const skill = parseSkillFile( fs.readFileSync( skillPath, 'utf8' ) );
		return skill ? [ { ...skill, folder } ] : [];
	} );
}
