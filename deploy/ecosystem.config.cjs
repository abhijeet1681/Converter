// PM2 process manager config:  pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'converthub',
    script: 'server.js',
    cwd: __dirname + '/..',
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production', PORT: 3000 },
  }],
};
