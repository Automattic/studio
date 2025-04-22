import { Command } from 'commander';

export type OutputFormat = undefined | 'json';
export type RegisterCommand = ( parentCommand: Command, rootCommand?: Command ) => void;
