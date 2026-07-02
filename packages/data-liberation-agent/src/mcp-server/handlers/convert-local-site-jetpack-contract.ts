export const JETPACK_FORMS_PLUGIN_INSTALL = {
  pluginSlug: 'jetpack',
  wpArgs: ['plugin', 'install', 'jetpack', '--activate'],
  gateDescription: 'formsConverted >= 1',
  flowLocation: 'after theme activation and before optional local interactivity plugin activation',
  failureMode: 'non-fatal warning only',
  warningPrefix: 'jetpack install/activate failed',
  localFormsNote: 'Jetpack Forms blocks render and store submissions locally without a WordPress.com connection.',
} as const;

export const JETPACK_FORMS_MODULE_ACTIVATE = {
  moduleSlug: 'contact-form',
  wpArgs: ['jetpack', 'module', 'activate', 'contact-form'],
  gateDescription: JETPACK_FORMS_PLUGIN_INSTALL.gateDescription,
  flowLocation: 'after Jetpack plugin install/activate succeeds and before optional local interactivity plugin activation',
  failureMode: JETPACK_FORMS_PLUGIN_INSTALL.failureMode,
  warningPrefix: 'jetpack contact-form module activate failed',
  localFormsNote: JETPACK_FORMS_PLUGIN_INSTALL.localFormsNote,
} as const;

export const JETPACK_FORMS_COMMAND_SEQUENCE = [
  JETPACK_FORMS_PLUGIN_INSTALL.wpArgs,
  JETPACK_FORMS_MODULE_ACTIVATE.wpArgs,
] as const;

export function shouldInstallJetpackFormsPlugin(formsConverted: number): boolean {
  return formsConverted >= 1;
}

export function jetpackFormsPluginInstallWarning(error: Error): string {
  return `${JETPACK_FORMS_PLUGIN_INSTALL.warningPrefix}: ${error.message}. ${JETPACK_FORMS_PLUGIN_INSTALL.localFormsNote}`;
}

export function jetpackFormsModuleActivateWarning(error: Error): string {
  return `${JETPACK_FORMS_MODULE_ACTIVATE.warningPrefix}: ${error.message}. ${JETPACK_FORMS_MODULE_ACTIVATE.localFormsNote}`;
}
