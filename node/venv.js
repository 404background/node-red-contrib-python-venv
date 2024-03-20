module.exports = function(RED) {
    function Venv(config) {
        RED.nodes.createNode(this,config)
        let node = this

        const fs = require('fs')
        const path = require('path')
        const filePath = path.join(path.dirname(__dirname), 'tmp', this.id + '.py')
        const pythonPath = path.join(path.dirname(__dirname), 'pyenv/Scripts/python.exe')
        let code = ""

        node.on('input', function(msg) {
            const command = pythonPath + ' ' + filePath

            if(config.code !== null && config.code !== "") {
                code = config.code
            } else {
                code = msg.code
            }
            fs.writeFileSync(filePath, code)
            
            let execSync = require('child_process').execSync
            msg.payload = String(execSync(command))
            node.send(msg)
        })
    }
    RED.nodes.registerType("venv", Venv)
}
