module.exports = function (RED) {
  function venvConfig(config) {
    RED.nodes.createNode(this, config)
    this.venvname = config.venvname
    this.version = config.version

    const path = require('path')
    const fs = require('fs')
    const execSync = require('child_process').execSync
    const setupPath = path.join(path.dirname(__dirname), 'setup.py')
    let venvPath = path.join(path.dirname(__dirname), this.venvname)

    let command = `python ${setupPath} "${this.venvname}"`
    if (
      typeof this.version !== 'undefined' &&
      this.version !== '' &&
      this.version !== 'default'
    ) {
      command += ` ${this.version}`
    }
    execSync(command)

    this.on('close', function (removed, done) {
      if (removed) {
        fs.rmSync(venvPath, { recursive: true, force: true })
      }
      done()
    })
  }
  
  RED.httpAdmin.get('/venvconfig/path', RED.auth.needsPermission('venvconfig.read'), function(req, res) {
    const path = require('path');
    const venvname = req.query.venvname;
    
    let absolutePath;
    if (path.isAbsolute(venvname)) {
      absolutePath = venvname;
    } else {
      absolutePath = path.resolve(path.join(path.dirname(path.dirname(__dirname)), venvname));
    }
    
    res.json({ path: absolutePath });
  });
  
  RED.nodes.registerType('venv-config', venvConfig)
}
