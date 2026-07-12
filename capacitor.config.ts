import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the Aquarius iPad testing shell.
 *
 * - appId is a placeholder; change it (and re-run `npx cap sync ios`) if you
 *   need a different bundle identifier for signing on a real device.
 * - webDir points at a tiny committed placeholder page (shell/www). During
 *   development the app never shows it: the `server.url` below makes the
 *   native WebView load the Next.js dev server instead. Capacitor just needs
 *   webDir to exist for `cap sync`.
 *
 * Dev-server modes:
 * - iOS Simulator: shares the Mac's network, so the default
 *   http://localhost:3000 works as-is.
 * - Real iPad: set CAP_SERVER_URL to http://<Mac-LAN-IP>:3000 and re-run
 *   `npm run ios:sync`, e.g.
 *     CAP_SERVER_URL=http://192.168.1.23:3000 npm run ios:sync
 * - Future static-export production build: set CAP_STATIC=1 (and point webDir
 *   at the export) so no server block is emitted and the bundled files load.
 */
const config: CapacitorConfig = {
  appId: 'com.stevee.aquarius',
  appName: 'Aquarius',
  webDir: 'shell/www',
  ...(process.env.CAP_STATIC
    ? {}
    : {
        server: {
          url: process.env.CAP_SERVER_URL || 'http://localhost:3000',
          cleartext: true,
        },
      }),
};

export default config;
