// pm2 process for the lookup relay. nginx serves the static files itself.
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: 'aion2-checklist',
      script: 'server.js',
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
