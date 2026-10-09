// pm2 process for the lookup relay. nginx serves the static files itself.
// Run `npm ci && npm run build` first; this starts the compiled dist/server.js.
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'aion2-checklist',
      script: 'dist/server.js',
      cwd: '/opt/aion2-checklist',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3005,
      },
      max_memory_restart: '200M',
    },
  ],
};
