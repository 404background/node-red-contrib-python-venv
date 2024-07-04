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

        let stdoutData = ''
        let stderrData = ''
        const child_process = require('child_process')
        let pythonProcess = null

        // config.continuous = true // TODO

        /**
         * In this mode, a single Python process runs continuously.
         * The messages are passed to the Python script via STDIN and read from STDOUT line by line.
         */
        function processContinous() {
            if (typeof config.code === 'string' && config.code !== '') {
                fs.writeFileSync(filePath, config.code)
            }
            pythonProcess = child_process.spawn(pythonPath, [filePath])

            pythonProcess.on('message', console.log)

            stdoutData = ''
            pythonProcess.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString()
                let lines = stdoutData.split('\n')
                stdoutData = lines.pop()
                for (let line of lines) {
                    if (line === '') {
                        continue
                    }
                    try {
                        let msg = JSON.parse(line)
                        node.send(msg)
                    } catch (e) {
                        node.error(e)
                    }
                }
            })

            stderrData = ''
            pythonProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString()
            })

            pythonProcess.on('close', (exitCode) => {
                if (exitCode !== 0) {
                    node.error(`Error ${exitCode}: ` + stderrData)
                }
                pythonProcess = null
            })
        }

        /**
         * In this mode, a new Python process is started for each message.
         * The message is passed to the Python script via a command line parameter and automatically decoded into the `msg` variable.
         * The result is read from STDOUT until the Python process is closed.
         */
        function processUntilClose(msg) {
            if (typeof msg.code === 'string' && msg.code !== '') {
                fs.writeFileSync(filePath, msg.code)
            }
            const message = Buffer.from(JSON.stringify(msg)).toString('base64')
            const args = ['-c', `import base64;import json;msg=json.loads(base64.b64decode(r'${message}'));exec(open(r'${filePath}').read())`]
            pythonProcess = child_process.spawn(pythonPath, args)

            pythonProcess.on('message', console.log)

            stdoutData = ''
            pythonProcess.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString()
            })

            stderrData = ''
            pythonProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString()
            })

            pythonProcess.on('close', (exitCode) => {
                if (exitCode !== 0) {
                    node.error(`Error ${exitCode}: ` + stderrData)
                } else {
                    msg.payload = stdoutData
                    node.send(msg)
                }
                pythonProcess = null
            })
        }

        node.on('input', function(msg) {
            if (config.continuous) {
                if (pythonProcess === null) {
                    processContinous()
                }
                pythonProcess.stdin.write(JSON.stringify(msg) + '\n')
            } else {
                processUntilClose(msg)
            }
        })
    }
    RED.nodes.registerType("venv", Venv)
}
