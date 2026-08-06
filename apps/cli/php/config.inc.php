<?php declare(strict_types = 1);

// Configure session save path for Studio's PHP runtime.
$session_dir = getenv('STUDIO_PHPMYADMIN_SESSION_PATH') ?: sys_get_temp_dir() . '/phpmyadmin-sessions';
if (!is_dir($session_dir)) {
    mkdir($session_dir, 0700, true);
}
session_save_path($session_dir);

// Enable development environment to display detailed error messages.
$cfg['environment'] = 'development';

// Studio's own theme. A user who picks another theme in phpMyAdmin's Appearance
// settings keeps it — the pma_theme cookie takes precedence over this default.
$cfg['ThemeDefault'] = 'studio';

// Start with the navigation panel collapsed: it holds only Recent and Favorites
// here (the database tree stays empty under the SQLite adapter), and Studio
// renders phpMyAdmin inside a preview pane where 240px is expensive. The
// collapser arrow reopens it. Note that reopening lasts for the page view only
// — without phpMyAdmin configuration storage, preferences live in the session,
// and persistOption() discards any value equal to the built-in default of 240.
// A width set by dragging the resizer is kept.
$cfg['NavigationWidth'] = 0;

// Playground-specific configuration.
$cfg['CheckConfigurationPermissions'] = false;
$cfg['VersionCheck'] = false;
$cfg['ShowCreateDb'] = false;
$cfg['ShowChgPassword'] = false;

// Cookie authentication secret.
$cfg['blowfish_secret'] = 'r/g+J#&)L2&p!z5gUS)d(vEU#KAynq#g';

// Server configuration
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['auth_type'] = 'config';
$cfg['Servers'][1]['user'] = 'root';
$cfg['Servers'][1]['password'] = '';
$cfg['Servers'][1]['AllowNoPassword'] = true;
$cfg['Servers'][1]['compress'] = false;
