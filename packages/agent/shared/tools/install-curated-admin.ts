import { Type } from 'typebox';
import { getSitePluginPath, installCuratedAdmin } from '@studio/agent/shared/curate-admin';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const installCuratedAdminTool = defineTool(
	'install_curated_admin',
	'Installs or updates the curated admin of a site from a manifest: the runtime plugin, a small ' +
		'plugin holding the manifest, and the Staff role when there is one. The `curate-admin` skill defines the manifest. ' +
		'Fills gaps in `brand` from DESIGN.md when the manifest has one. Safe to call again after changing the manifest.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		manifest: Type.Unknown( {
			description: 'The curated admin manifest, as defined by the `curate-admin` skill.',
		} ),
	},
	async ( args, context ) => {
		const site = await context.host.sites.resolve( args.nameOrPath );
		const { manifest, locale, untranslated } = await installCuratedAdmin(
			context.host,
			site,
			args.manifest
		);

		const summary = [
			`${ manifest.postTypes?.length ?? 0 } post types`,
			`${ manifest.settings?.length ?? 0 } settings pages`,
		].join( ' and ' );
		const lines = manifest.staff
			? [
					`Curated admin installed on "${ site.name }" with the role "${ manifest.role?.name }" (${ manifest.role?.slug }), ${ manifest.menu.keep?.length } menu items, ${ summary }.`,
					`The Staff account is "${ manifest.staff.login }". Studio opens wp-admin signed in as it at ${ site.url }/studio-auto-login?user=${ manifest.staff.login }&redirect_to=/wp-admin/.`,
			  ]
			: [
					`wp-admin is curated for everyone who logs in to "${ site.name }": ${ manifest.menu.hide?.length } menu items hidden, ${ summary }, and no Staff account.`,
					'Administrators reach everything else with Full admin in the toolbar.',
			  ];
		if ( manifest.brand ) {
			lines.push( `Brand: ${ JSON.stringify( manifest.brand ) }` );
		}
		lines.push(
			`Block templates in ${ getSitePluginPath(
				context.host,
				site
			) }/templates load as the post types' single and archive templates.`
		);
		if ( untranslated.length ) {
			lines.push(
				`The site's language is ${ locale }. Add these to manifest.strings, English text as the key, with the translation as the value, then call this tool again:`,
				JSON.stringify( untranslated )
			);
		}
		return textResult( lines.join( '\n' ) );
	},
	{
		annotations: LOCAL_CHANGE,
		promptSnippet:
			'Install or update a curated admin on a site from its manifest (see the `curate-admin` skill).',
	}
);
