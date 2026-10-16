import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../skills';

const pluginSkillsRoot = path.resolve(
	import.meta.dirname,
	'../../../../plugins/wp-studio/skills'
);

describe( 'wp-studio plugin skills', () => {
	it( 'exposes every top-level skill with its description, and nothing else besides the global entry', () => {
		const topLevel = loadSkills().filter( ( skill ) => skill.userInvokable );
		expect( fs.readdirSync( pluginSkillsRoot ).sort() ).toEqual(
			[ ...topLevel.map( ( skill ) => skill.name ), 'wordpress-studio' ].sort()
		);
		for ( const skill of topLevel ) {
			const stub = fs.readFileSync(
				path.join( pluginSkillsRoot, skill.name, 'SKILL.md' ),
				'utf-8'
			);
			expect( stub ).toContain( `\nname: ${ skill.name }\n` );
			expect( stub ).toContain( `\ndescription: ${ skill.description }\n` );
			expect( stub ).toContain( `\`skill: "${ skill.name }"\`` );
		}
	} );
} );
