module.exports = function(RED) {
    function Venv(config) {
        RED.nodes.createNode(this,config)
        let node = this

        const fs = require('fs')
        const path = require('path')
        const filePath = path.join(path.dirname(__dirname), 'tmp', this.id + '.py')
        const jsonPath = path.join(path.dirname(__dirname), 'path.json')
        const json = fs.readFileSync(jsonPath)
        const pythonPath = JSON.parse(json).NODE_PYENV_PYTHON
        let code = ""

        node.on('input', function(msg) {
            // Base64 encoded JSON string of the message:
            const message = Buffer.from(JSON.stringify({
                "payload": msg.payload,
            })).toString('base64')
            const command = `${pythonPath} -c "import base64;import json;msg=json.loads(base64.b64decode(r'${message}'));exec(open(r'${filePath}').read())"`

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
