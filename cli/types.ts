import { Argv } from 'yargs';

export interface GlobalOptions {
	path: string;
}

export type StudioArgv = Argv< GlobalOptions >;
