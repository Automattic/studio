import type { Handler } from '../handler-types.js';

export const setupHandler: Handler = async (args, ctx) => {
  // Delegate mode: return a manifest for the calling environment
  if (args.delegate) {
    return ctx.textResult({
      mode: 'delegate',
      manifest: {
        description: 'A running WordPress site is needed to receive the imported content.',
        requirements: [
          'A WordPress site must be available and running',
          'The site should have the WordPress Importer plugin installed and activated',
          'If products will be imported, WooCommerce should be installed and activated',
        ],
      },
    });
  }

  // REST API mode: validate connection
  const { validateWpConnection } = await import('../../lib/setup/wp-setup.js');
  const report = await validateWpConnection({
    site: args.site as string,
    username: args.username as string,
    token: args.token as string,
  });
  return ctx.textResult(report);
};
