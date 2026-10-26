import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readModelsJsonModels } from '../models-json';

describe( 'models.json models', () => {
	let configDir: string;
	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-models-json-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	} );
	afterEach( () => {
		vi.unstubAllEnvs();
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'lists none without a models.json', async () => {
		expect( await readModelsJsonModels() ).toEqual( [] );
	} );

	it( 'lists the models of the providers it names, by provider/model reference', async () => {
		fs.writeFileSync(
			path.join( configDir, 'models.json' ),
			JSON.stringify( {
				providers: {
					local: {
						baseUrl: 'http://127.0.0.1:1/v1',
						api: 'openai-completions',
						apiKey: 'k',
						models: [ { id: 'sees' }, { id: 'vendor/reads' } ],
					},
				},
			} )
		);
		// pi's built-in providers it does not name are not listed.
		expect( await readModelsJsonModels() ).toEqual( [ 'local/sees', 'local/vendor/reads' ] );
	} );
} );
