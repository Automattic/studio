import { readFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { renderPreferredPlugins } from '@studio/agent/shared/preferred-plugins';

it( 'shows the preferred plugins as the plugin-recommendations skill states them', () => {
	const skill = readFileSync(
		path.join( import.meta.dirname, '../../shared/skills/plugin-recommendations/SKILL.md' ),
		'utf8'
	);
	expect( skill ).toContain( renderPreferredPlugins() );
} );
