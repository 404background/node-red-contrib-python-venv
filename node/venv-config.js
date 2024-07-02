module.exports = function(RED) {
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
        if(typeof this.version !== 'undefined' && this.version !== '' && this.version !== 'default') {
            command += ` ${this.version}`
        }
        execSync(command)

        this.on('close', function(removed, done) {
            if (removed) {
                fs.rmSync(venvPath, { recursive: true, force: true })
            }
            done()
        })
    }
    RED.nodes.registerType("venv-config",venvConfig)
}
