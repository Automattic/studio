import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { HighlighterCore, LanguageRegistration, TokensResult } from 'shiki/core';

type Grammar = Promise< { default: LanguageRegistration[] } >;

// The languages a chat about WordPress sites shows; anything else stays plain.
const LANGUAGES: Record< string, () => Grammar > = {
	php: () => import( 'shiki/langs/php.mjs' ),
	html: () => import( 'shiki/langs/html.mjs' ),
	css: () => import( 'shiki/langs/css.mjs' ),
	scss: () => import( 'shiki/langs/scss.mjs' ),
	javascript: () => import( 'shiki/langs/javascript.mjs' ),
	typescript: () => import( 'shiki/langs/typescript.mjs' ),
	jsx: () => import( 'shiki/langs/jsx.mjs' ),
	tsx: () => import( 'shiki/langs/tsx.mjs' ),
	json: () => import( 'shiki/langs/json.mjs' ),
	shellscript: () => import( 'shiki/langs/shellscript.mjs' ),
	sql: () => import( 'shiki/langs/sql.mjs' ),
	yaml: () => import( 'shiki/langs/yaml.mjs' ),
	xml: () => import( 'shiki/langs/xml.mjs' ),
	markdown: () => import( 'shiki/langs/markdown.mjs' ),
	diff: () => import( 'shiki/langs/diff.mjs' ),
};

const ALIASES: Record< string, string > = {
	js: 'javascript',
	ts: 'typescript',
	sh: 'shellscript',
	bash: 'shellscript',
	shell: 'shellscript',
	zsh: 'shellscript',
	yml: 'yaml',
	md: 'markdown',
};

let highlighter: Promise< HighlighterCore > | undefined;

export async function highlight( code: string, language: string ): Promise< TokensResult | null > {
	const lang = ALIASES[ language ] ?? language;
	const grammar = LANGUAGES[ lang ];
	if ( ! grammar ) {
		return null;
	}
	highlighter ??= createHighlighterCore( {
		themes: [ import( 'shiki/themes/github-light.mjs' ), import( 'shiki/themes/github-dark.mjs' ) ],
		engine: createJavaScriptRegexEngine(),
	} );
	const instance = await highlighter;
	if ( ! instance.getLoadedLanguages().includes( lang ) ) {
		await instance.loadLanguage( grammar() );
	}
	return instance.codeToTokens( code, {
		lang,
		themes: { light: 'github-light', dark: 'github-dark' },
		defaultColor: 'light-dark()',
	} );
}
