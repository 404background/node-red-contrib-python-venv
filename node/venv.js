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

        const child_process = require('child_process')

        node.on('input', function(msg) {
            let code = ''
            if(config.code !== null && config.code !== '') {
                code = config.code
            } else {
                code = msg.code
            }
            fs.writeFileSync(filePath, code)
            
            const message = Buffer.from(JSON.stringify(msg)).toString('base64')
            const args = ['-c', `import base64;import json;msg=json.loads(base64.b64decode(r'${message}'));exec(open(r'${filePath}').read())`]
            const pythonProcess = child_process.spawn(pythonPath, args)
            let stdoutData = ''
            let stderrData = ''

            pythonProcess.on('message', console.log)

            pythonProcess.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString()
            })
            
            pythonProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString()
            })
            
            pythonProcess.on('close', (exitCode) => {
                if (exitCode !== 0) {
                    node.error(stderrData)
                } else {
                    msg.payload = stdoutData
                    node.send(msg)
                }
            })
        })
    }
    RED.nodes.registerType("venv", Venv)
}
