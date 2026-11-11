import { ArgumentsCamelCase, Argv } from 'yargs';

export interface GlobalOptions {
	path: string;
}

export type StudioArgv = Argv< GlobalOptions >;

// The parsed arguments of a command whose options are added by `builder`.
export type CommandArgs< Builder extends ( yargs: StudioArgv ) => Argv< unknown > > =
	ArgumentsCamelCase< Builder extends ( yargs: StudioArgv ) => Argv< infer Args > ? Args : never >;
