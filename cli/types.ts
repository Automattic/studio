import { Command } from 'commander';

export type OutputFormat = undefined | 'json';
export type RegisterCommand = ( program: Command, outputFormat?: OutputFormat ) => void;
