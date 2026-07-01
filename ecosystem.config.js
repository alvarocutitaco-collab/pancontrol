module.exports = {
  apps: [
    {
      name: 'pancontrol',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        TRUST_PROXY: '1',
        PORT: 3000
      }
    }
  ]
};
