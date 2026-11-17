import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleTester } from 'eslint';
import { afterAll, describe } from 'vitest';
import rule from '../src/rules/provider-registration';

const ruleTester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
	},
} );

// A provider package: `registered` is in the registration with its services, `unregistered` and
// `servicesless` have only a descriptor, and only `servicesless` is registered.
const root = fs.mkdtempSync( path.join( os.tmpdir(), 'provider-registration-' ) );
const registry = `
import { registeredProvider } from './registered/descriptor';
import { servicelessProvider } from './serviceless/descriptor';

const PROVIDERS = [ registeredProvider, servicelessProvider ];
`;
const descriptor = `
import { defineProvider } from '../types';

export const provider = defineProvider( { id: 'sample' } );
`;
const services = `
import { defineServices } from '../types';
import { provider } from './descriptor';

export const services = defineServices( provider, { account } );
`;
const files: Record< string, string > = {
	'registry.ts': registry,
	'registered/descriptor.ts': descriptor,
	'registered/services.ts': services,
	'unregistered/descriptor.ts': descriptor,
	'serviceless/descriptor.ts': descriptor,
};
for ( const [ file, code ] of Object.entries( files ) ) {
	fs.mkdirSync( path.dirname( path.join( root, file ) ), { recursive: true } );
	fs.writeFileSync( path.join( root, file ), code );
}
const at = ( file: string ) => path.join( root, file );

afterAll( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

describe( 'provider-registration', () => {
	ruleTester.run( 'provider-registration', rule, {
		valid: [
			{ code: registry.replace( ', servicelessProvider', '' ), filename: at( 'registry.ts' ) },
			{ code: descriptor, filename: at( 'registered/descriptor.ts' ) },
			{ code: services, filename: at( 'registered/services.ts' ) },
		],
		invalid: [
			{
				code: descriptor,
				filename: at( 'unregistered/descriptor.ts' ),
				errors: [
					{
						messageId: 'unregistered',
						data: { folder: 'unregistered' },
						line: 4,
					},
				],
			},
			{
				code: registry,
				filename: at( 'registry.ts' ),
				errors: [
					{
						messageId: 'missingServices',
						data: { folder: 'serviceless' },
						line: 5,
					},
				],
			},
			{
				code: services.replace( 'export const services', 'export const exampleServices' ),
				filename: at( 'registered/services.ts' ),
				errors: [ { messageId: 'servicesExport' } ],
			},
			{
				code: `
					import { account } from './account';

					export const services = { id: 'sample', account };
				`,
				filename: at( 'registered/services.ts' ),
				errors: [ { messageId: 'servicesExport' } ],
			},
		],
	} );
} );
