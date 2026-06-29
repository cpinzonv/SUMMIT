'use strict';

const { contextBridge } = require('electron');

// Expose a tiny, safe surface to the renderer so the React app can tell it's
// running inside the desktop shell (e.g. to tweak UI). No Node APIs leak
// through — contextIsolation + sandbox keep the renderer locked down.
contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  appVersion: process.env.npm_package_version || null,
});
