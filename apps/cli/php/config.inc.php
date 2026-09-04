<?php declare(strict_types = 1);

// Configure session save path for Studio's PHP runtime.
$session_dir = getenv('STUDIO_PHPMYADMIN_SESSION_PATH') ?: sys_get_temp_dir() . '/phpmyadmin-sessions';
if (!is_dir($session_dir)) {
    mkdir($session_dir, 0700, true);
}
session_save_path($session_dir);

// Enable development environment to display detailed error messages.
$cfg['environment'] = 'development';

$studio_database_cookie = 'studio_database';
$studio_database_enabled = ($_COOKIE[$studio_database_cookie] ?? '1') !== '0';
if (isset($_GET[$studio_database_cookie])) {
    $studio_database_enabled = $_GET[$studio_database_cookie] !== '0';
    setcookie($studio_database_cookie, $studio_database_enabled ? '1' : '0', [
        'path' => '/phpmyadmin',
        'samesite' => 'Lax',
    ]);
}
define('STUDIO_DATABASE_ENABLED', $studio_database_enabled);

if ($studio_database_enabled) {
    // Use phpMyAdmin's bundled Bootstrap theme consistently in Studio.
    $cfg['ThemeDefault'] = 'bootstrap';
    $cfg['ThemeManager'] = false;
    unset($_COOKIE['pma_theme']);

    // Keep the embedded database view compact and favor readable text actions over
    // phpMyAdmin's repeated icon and text presentation.
    $cfg['NavigationWidth'] = 0;
    $cfg['NavigationTreeEnableGrouping'] = false;
    $cfg['TabsMode'] = 'text';
    $cfg['ActionLinksMode'] = 'text';
    $cfg['RowActionType'] = 'text';
    $cfg['TableNavigationLinksMode'] = 'text';
    $cfg['ShowStats'] = false;
    $cfg['ShowServerInfo'] = false;
    $cfg['ShowColumnComments'] = false;
    $cfg['UserprefsDisallow'] = [
        'ThemeDefault',
        'NavigationWidth',
        'NavigationTreeEnableGrouping',
        'TabsMode',
        'ActionLinksMode',
        'RowActionType',
        'TableNavigationLinksMode',
        'ShowStats',
        'ShowServerInfo',
        'ShowColumnComments',
    ];
}

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
