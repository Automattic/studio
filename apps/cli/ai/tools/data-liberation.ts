import path from 'path';
import { Type } from 'typebox';
import {
	callDataLiberationTool,
	getDataLiberationEngineDir,
	listDataLiberationTools,
} from 'cli/lib/data-liberation-client';
import { defineTool } from './define-tool';
import { textResult } from './utils';

const engineDir = getDataLiberationEngineDir();

// The model sometimes sends `args` as a JSON-encoded STRING instead of an object;
// forwarding that as MCP `arguments` fails the SDK schema ("expected record").
// Coerce nullish → {}, a JSON string → its parsed object, and reject anything else.
function normalizeArgs( raw: unknown ): Record< string, unknown > {
	let value = raw;
	if ( typeof value === 'string' ) {
		const trimmed = value.trim();
		if ( ! trimmed ) {
			return {};
		}
		try {
			value = JSON.parse( trimmed );
		} catch {
			throw new Error(
				`data_liberation: \`args\` must be a JSON object, not a stringified JSON. Received: ${ trimmed.slice(
					0,
					200
				) }`
			);
		}
	}
	if ( value === undefined || value === null ) {
		return {};
	}
	if ( typeof value !== 'object' || Array.isArray( value ) ) {
		throw new Error( 'data_liberation: `args` must be a JSON object.' );
	}
	return value as Record< string, unknown >;
}

export const dataLiberationTool = defineTool(
	'data_liberation',
	'Bridge to the Data Liberation engine, which extracts content from closed web platforms ' +
		'(GoDaddy, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) ' +
		'and reconstructs it into a WordPress site. This tool forwards a single call to the engine; ' +
		"the `/liberate` skill orchestrates the full sequence. Pass `tool: 'setup'` to get the paths " +
		'to its skill files (the engine ships prebuilt with Studio).',
	{
		tool: Type.Optional(
			Type.String( {
				description:
					"Engine MCP tool name, e.g. 'liberate_detect', 'liberate_discover', 'liberate_extract', " +
					"'liberate_reconstruct_pages', 'liberate_install_theme'. Pass 'setup' to get the engine's " +
					"skill-file paths, or 'list' to fetch the full catalog of engine tools with " +
					'their argument schemas — consult it whenever you are unsure of a tool name or its arguments.',
			} )
		),
		args: Type.Optional(
			Type.Unknown( {
				description:
					'Arguments forwarded to the engine tool. MUST be a JSON OBJECT, not a stringified ' +
					'JSON — e.g. { "url": "https://example.com" }, NOT "{\\"url\\":\\"…\\"}". ' +
					"Site-targeting tools expect a Studio target, e.g. { kind: 'studio', sitePath: '/Users/you/Studio/my-site' }.",
			} )
		),
	},
	async ( args ) => {
		if ( ! args.tool ) {
			throw new Error(
				'data_liberation: a `tool` is required. Pass "setup" to get the engine skill-file paths, ' +
					'"list" for the tool catalog, or an engine tool name (e.g. "liberate_detect").'
			);
		}

		if ( args.tool === 'setup' ) {
			return textResult(
				JSON.stringify( {
					engineDir,
					skillsDir: path.join( engineDir, 'skills' ),
					liberateSkill: path.join( engineDir, 'skills', 'liberate', 'SKILL.md' ),
				} )
			);
		}

		if ( args.tool === 'list' ) {
			return textResult( JSON.stringify( await listDataLiberationTools(), null, 2 ) );
		}
		return textResult(
			JSON.stringify(
				await callDataLiberationTool( args.tool, normalizeArgs( args.args ) ),
				null,
				2
			)
		);
	}
);
