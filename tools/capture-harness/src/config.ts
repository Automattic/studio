import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './paths.ts';
import type { Profile } from './profile.ts';

type Section = Record< string, unknown >;
export type StudioConfig = Record< string, unknown > & {
	preferences?: Section;
	providers?: Section & { configs?: Section };
	sites?: Section[];
	sessions?: Record< string, Section >;
	cli?: Section;
};

// The profile's Studio config file, which every Studio app and the CLI read.
function configPath( profile: Pick< Profile, 'dirs' > ): string {
	return path.join( profile.dirs.config, 'config.json' );
}

export async function updateProfileConfig(
	profile: Pick< Profile, 'dirs' >,
	update: ( config: StudioConfig ) => void
): Promise< void > {
	const config = await readJson< StudioConfig >( configPath( profile ) ).catch(
		(): StudioConfig => ( { version: 1 } )
	);
	update( config );
	await writeFile( configPath( profile ), JSON.stringify( config, null, 2 ) );
}
