/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { rewriteJson } from '@studio/common/lib/json-text';

// A theme.json as eval9 to eval11 builds wrote it: presets on one line each.
const WRITTEN = `{
	"version": 3,
	"settings": {
		"color": {
			"palette": [
				{ "slug": "base", "color": "#ffffff", "name": "Base" },
				{ "slug": "ink", "color": "#111111", "name": "Ink" }
			]
		},
		"typography": {
			"fontFamilies": [
				{
					"slug": "body",
					"name": "Inter",
					"fontFamily": "Inter, sans-serif"
				}
			]
		}
	}
}
`;

describe( 'rewriteJson', () => {
	it( 'writes what changed, and every other line as written', () => {
		const json = JSON.parse( WRITTEN );
		json.settings.typography.fontFamilies[ 0 ].fontFace = [
			{ fontFamily: 'Inter', src: [ 'file:./assets/fonts/inter.woff2' ] },
		];
		json.settings.typography.defaultFontSizes = false;
		const text = rewriteJson( WRITTEN, json );
		expect( JSON.parse( text ) ).toEqual( json );
		expect( text ).toBe( `{
	"version": 3,
	"settings": {
		"color": {
			"palette": [
				{ "slug": "base", "color": "#ffffff", "name": "Base" },
				{ "slug": "ink", "color": "#111111", "name": "Ink" }
			]
		},
		"typography": {
			"fontFamilies": [
				{
					"slug": "body",
					"name": "Inter",
					"fontFamily": "Inter, sans-serif",
					"fontFace": [
						{
							"fontFamily": "Inter",
							"src": [
								"file:./assets/fonts/inter.woff2"
							]
						}
					]
				}
			],
			"defaultFontSizes": false
		}
	}
}
` );
	} );
} );
