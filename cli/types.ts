import { Argv } from 'yargs';

export type OutputFormat = undefined | 'json';

export interface GlobalOptions {
	outputFormat?: OutputFormat;
}

export type StudioArgv = Argv< GlobalOptions >;
