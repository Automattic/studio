/**
 * Plants one violation per check in a copy of the repo's layout and runs oxlint with the root
 * `.oxlintrc.json` on it, so a config or oxlint change that silently drops a check fails here.
 * Each case: name, file, its code, the rule that must report it (null: none may), extra files.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const root = path.resolve( import.meta.dirname, '..' );

const TRANSLATE = "declare function __( s: string ): string;\nexport const label = __( 'x' );\n";
const DIRNAME = 'export const dir = __dirname;\n';

const SUPPORT = {
	'apps/ui/src/features/zz-a/index.ts': 'export const a = 1;\n',
	'apps/ui/src/features/zz-a/inner.ts': 'export const inner = 1;\n',
	'apps/ui/src/lib/zz-lib/index.ts': 'export const l = 1;\n',
	'apps/ui/src/lib/zz-lib/inner.ts': 'export const inner = 1;\n',
	'packages/ds/primitives/zz-inner.ts': 'export const p = 1;\n',
	'apps/ui/src/zz-x.ts': 'export const x = 1;\n',
	'packages/providers/zz-p/impl.ts': 'export const impl = 1;\n',
	'packages/providers/zz-p/config.ts': 'export const config = 1;\n',
};

const CASES = [
	[
		'floating promise',
		'packages/common/lib/zz-float.ts',
		'async function load() {\n\treturn 1;\n}\nexport function run() {\n\tload();\n}\n',
		'typescript(no-floating-promises)',
	],
	[
		'explicit any',
		'packages/common/lib/zz-any.ts',
		'export const value: any = 1;\n',
		'typescript(no-explicit-any)',
	],
	[
		'ts-ignore',
		'packages/common/lib/zz-ts-ignore.ts',
		'// @ts-ignore\nexport const value: number = 1;\n',
		'typescript(ban-ts-comment)',
	],
	[
		'require in tsx',
		'apps/ui/src/features/zz-a/zz-require.tsx',
		"export const lib = require( 'node:path' );\n",
		'typescript(no-require-imports)',
	],
	[
		'module-level translation',
		'apps/ui/src/features/zz-a/zz-i18n.ts',
		TRANSLATE,
		'studio(no-module-level-translations)',
	],
	[ 'module-level translation in the CLI', 'apps/cli/zz-i18n.ts', TRANSLATE, null ],
	[ '__dirname in the CLI', 'apps/cli/zz-dirname.ts', DIRNAME, 'eslint(no-restricted-globals)' ],
	[
		'__filename in scripts',
		'scripts/zz-filename.mjs',
		'export const file = __filename;\n',
		'eslint(no-restricted-globals)',
	],
	[
		'@wordpress/components in the UI',
		'apps/ui/src/features/zz-a/zz-wp.ts',
		"export { Button } from '@wordpress/components';\nimport '@wordpress/components';\n",
		'eslint(no-restricted-imports)',
	],
	[
		'Base UI in the UI',
		'apps/ui/src/features/zz-a/zz-base.ts',
		"import { Dialog } from '@base-ui/react';\nexport { Dialog };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'TanStack in lib/',
		'apps/ui/src/lib/zz-lib/zz-tanstack.ts',
		"import { useQuery } from '@tanstack/react-query';\nexport { useQuery };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'agent internals in an app',
		'apps/studio/src/zz-agent.ts',
		"import { x } from '@studio/agent/node/tools/zz';\nexport { x };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'agent public module in an app',
		'apps/studio/src/zz-agent-ok.ts',
		"import { x } from '@studio/agent/node/run-manager';\nexport { x };\n",
		null,
	],
	[
		'workspace package in ds',
		'packages/ds/hooks/zz-common.ts',
		"import { x } from '@studio/common/lib/zz';\nexport { x };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'agent in common',
		'packages/common/lib/zz-agent.ts',
		"import { x } from '@studio/agent/node/zz';\nexport { x };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'provider services in common',
		'packages/common/lib/zz-services.ts',
		"import { x } from '@studio/providers/anthropic/services';\nexport { x };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'Node API in providers',
		'packages/providers/zz-node.ts',
		"import fs from 'node:fs';\nexport { fs };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'app in the agent',
		'packages/agent/node/zz-app.ts',
		"import { x } from 'cli/lib/zz';\nexport { x };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'Node API in the protocol',
		'packages/agent/protocol/zz-node.ts',
		"import fs from 'fs';\nexport { fs };\n",
		'eslint(no-restricted-imports)',
	],
	[
		'feature internals from another feature',
		'apps/ui/src/features/zz-b/deep.ts',
		"import { inner } from '@/features/zz-a/inner';\nexport { inner };\n",
		'studio(import-boundaries)',
	],
	[
		'feature entry from another feature',
		'apps/ui/src/features/zz-b/entry.ts',
		"import { a } from '@/features/zz-a';\nexport { a };\n",
		null,
	],
	[
		'feature from lib/',
		'apps/ui/src/lib/zz-lib/zz-feature.ts',
		"import { a } from '@/features/zz-a';\nexport { a };\n",
		'studio(import-boundaries)',
	],
	[
		'feature from data/',
		'apps/ui/src/data/zz-feature.ts',
		"import { a } from '@/features/zz-a';\nexport { a };\n",
		'studio(import-boundaries)',
	],
	[
		'lib internals from a feature',
		'apps/ui/src/features/zz-b/lib-deep.ts',
		"import { inner } from '@/lib/zz-lib/inner';\nexport { inner };\n",
		'studio(import-boundaries)',
	],
	[
		'lib entry from a feature',
		'apps/ui/src/features/zz-b/lib-entry.ts',
		"import { l } from '@/lib/zz-lib';\nexport { l };\n",
		null,
	],
	[
		'ds folder internals from another folder',
		'packages/ds/hooks/zz-deep.ts',
		"import { p } from '../primitives/zz-inner';\nexport { p };\n",
		'studio(import-boundaries)',
	],
	[
		'an app from ds',
		'packages/ds/hooks/zz-app.ts',
		"import { x } from '../../../apps/ui/src/zz-x';\nexport { x };\n",
		'studio(import-boundaries)',
	],
	[
		'provider internals from a descriptor',
		'packages/providers/zz-p/descriptor.ts',
		"import { impl } from './impl';\nexport { impl };\n",
		'studio(import-boundaries)',
	],
	[
		'provider config from a descriptor',
		'packages/providers/zz-p/descriptor-ok.ts',
		"import { config } from './config';\nexport { config };\n",
		null,
	],
	[
		'import cycle in the UI',
		'apps/ui/src/features/zz-c/a.ts',
		"import { b } from './b';\nexport const a = () => b;\n",
		'import(no-cycle)',
		{ 'apps/ui/src/features/zz-c/b.ts': "import { a } from './a';\nexport const b = () => a;\n" },
	],
	[
		'conditional hook',
		'apps/ui/src/features/zz-a/zz-hook.tsx',
		"import { useState } from 'react';\nexport function View( { on }: { on: boolean } ) {\n\tif ( on ) {\n\t\tuseState( 0 );\n\t}\n\treturn null;\n}\n",
		'react-hooks(rules-of-hooks)',
	],
	[
		'component made during render',
		'apps/ui/src/features/zz-a/zz-static.tsx',
		'export function View() {\n\tconst Inner = () => <div />;\n\treturn <Inner />;\n}\n',
		'react(static-components)',
	],
	[
		'jest-dom matcher',
		'apps/ui/src/features/zz-a/zz.test.tsx',
		"import { expect, test } from 'vitest';\ntest( 'x', () => {\n\tconst el = document.createElement( 'div' );\n\texpect( el.hasAttribute( 'title' ) ).toBe( true );\n} );\n",
		'jest-dom(prefer-to-have-attribute)',
	],
	[
		'type-only import cycle',
		'apps/ui/src/features/zz-t/a.ts',
		"import type { B } from './b';\nexport type A = { b?: B };\nexport const a = 1;\n",
		null,
		{
			'apps/ui/src/features/zz-t/b.ts':
				"import { a } from './a';\nexport type B = number;\nexport const b = a;\n",
		},
	],
	[
		'unused variable',
		'packages/common/lib/zz-unused.ts',
		'const unused = 1;\nexport {};\n',
		'eslint(no-unused-vars)',
	],
];

let dir;
const findings = {};

beforeAll( () => {
	dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-lint-config-' ) );
	const config = JSON.parse( fs.readFileSync( path.join( root, '.oxlintrc.json' ), 'utf8' ) );
	config.jsPlugins = config.jsPlugins.map( ( plugin ) =>
		typeof plugin === 'object' && plugin.specifier.startsWith( '.' )
			? { ...plugin, specifier: path.join( root, plugin.specifier ) }
			: plugin
	);
	const files = {
		'.oxlintrc.json': JSON.stringify( config ),
		'tsconfig.json': JSON.stringify( {
			compilerOptions: {
				strict: true,
				noEmit: true,
				allowJs: true,
				skipLibCheck: true,
				jsx: 'react-jsx',
				module: 'esnext',
				moduleResolution: 'bundler',
				paths: { '@/*': [ './apps/ui/src/*' ] },
			},
			include: [ '**/*' ],
		} ),
		...SUPPORT,
	};
	for ( const [ , file, code, , extra ] of CASES ) {
		Object.assign( files, { [ file ]: code }, extra );
	}
	for ( const [ file, code ] of Object.entries( files ) ) {
		fs.mkdirSync( path.dirname( path.join( dir, file ) ), { recursive: true } );
		fs.writeFileSync( path.join( dir, file ), code );
	}
	fs.symlinkSync( path.join( root, 'node_modules' ), path.join( dir, 'node_modules' ), 'junction' );

	const { stdout, stderr } = spawnSync(
		path.join( root, 'node_modules/.bin', process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint' ),
		[ '-f', 'unix', ...CASES.map( ( [ , file ] ) => file ) ],
		{ cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' }
	);
	for ( const line of stdout.split( '\n' ) ) {
		const match = line.match( /^(.+?):\d+:\d+: .*\[\w+\/(.+)\]$/ );
		if ( match ) {
			( findings[ match[ 1 ].split( path.sep ).join( '/' ) ] ??= [] ).push( match[ 2 ] );
		}
	}
	if ( ! stdout.trim() ) {
		throw new Error( `oxlint printed nothing:\n${ stderr }` );
	}
}, 120_000 );

afterAll( () => {
	if ( dir ) {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
} );

it.each( CASES )( '%s', ( _name, file, _code, rule ) => {
	if ( rule ) {
		expect( findings[ file ] ).toContain( rule );
	} else {
		expect( findings[ file ] ).toBeUndefined();
	}
} );
