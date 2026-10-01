import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/no-exit-or-prompt-in-run-command';

const ruleTester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
} );

describe( 'no-exit-or-prompt-in-run-command', () => {
	ruleTester.run( 'no-exit-or-prompt-in-run-command', rule, {
		valid: [
			{
				code: `import { confirm } from '@inquirer/prompts';
				export async function runCommand( ask ) { process.exitCode = 1; await ask(); }
				const handler = async () => { await runCommand( () => confirm( {} ) ); process.exit( 0 ); };`,
			},
		],
		invalid: [
			{
				code: `export async function runCommand() { process.exit( 0 ); }`,
				errors: [ { messageId: 'exit' } ],
			},
			{
				code: `import { confirm } from '@inquirer/prompts';
				export const runCommand = async () => { if ( x ) { await confirm( {} ); } };`,
				errors: [ { messageId: 'prompt' } ],
			},
			{
				code: `import * as prompts from '@inquirer/prompts';
				export async function runCommand() { [ 1 ].forEach( () => prompts.select( {} ) ); }`,
				errors: [ { messageId: 'prompt' } ],
			},
		],
	} );
} );
