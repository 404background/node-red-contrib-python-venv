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

        const execSync = require('child_process').execSync
        let code = ""

        node.status({fill:"green",shape:"dot",text:"Standby"})

        node.on('input', function(msg) {
            node.status({fill:"blue",shape:"dot",text:"Script is running"})
            const message = Buffer.from(JSON.stringify(msg)).toString('base64')
            const command = `${pythonPath} -c "import base64;import json;msg=json.loads(base64.b64decode(r'${message}'));exec(open(r'${filePath}').read())"`

            if(config.code !== null && config.code !== "") {
                code = config.code
            } else {
                code = msg.code
            }
            fs.writeFileSync(filePath, code)
            
            msg.payload = String(execSync(command))
            node.send(msg)

            node.status({fill:"green",shape:"dot",text:"Standby"})
        })
    }
    RED.nodes.registerType("venv", Venv)
}
