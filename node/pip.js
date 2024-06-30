module.exports = function(RED) {
    function Pip(config) {
        RED.nodes.createNode(this,config)
        let node = this
        this.venvconfig = RED.nodes.getNode(config.venvconfig)

        const path = require('path')
        const fs = require('fs')
        let jsonPath = path.join(path.dirname(__dirname), 'pyenv', 'path.json')
        if(this.venvconfig) {
            jsonPath = path.join(path.dirname(__dirname), this.venvconfig.venvname, 'path.json')
        }
        const json = fs.readFileSync(jsonPath)
        const pipPath = JSON.parse(json).NODE_PYENV_PIP
        const child_process = require('child_process')

        node.on('input', function(msg) {
            let argument = ''
            let args = []
            let stdoutData = ''
            let stderrData = ''

            if(typeof config.arg !== 'undefined' && config.arg !== '') {
                argument = String(config.arg)
            } else if(typeof msg.payload !== 'undefined' && msg.payload !== ''){
                argument = String(msg.payload)
            } else {
                argument = ''
            }

            switch(config.action) {
                case 'install':
                    if(argument === '') { 
                        const errTxt = "Install: No argument provided"
                        node.status({fill:"red", shape:"dot", text:errTxt})
                        node.error(errTxt)
                    } else {
                        args = ['install', ...argument.split(' ')]
                    }
                    break
                case 'uninstall':
                    if(argument === '') { 
                        const errTxt = "Uninstall: No argument provided"
                        node.status({fill:"red", shape:"dot", text:errTxt})
                        node.error(errTxt)
                    } else {
                        args = ['uninstall', '-y', ...argument.split(' ')]
                    }
                    break
                case 'list':
                    args = ['list']
                    argument = ''
                    break
                default:
                    args = []
                    break
            }

            if(args.length === 0) return
            
            node.status({fill:"blue",shape:"dot",text:`${config.action}ing ${argument}`})

            const pipProcess = child_process.spawn(pipPath, args)

            pipProcess.on('message', console.log)

            pipProcess.stdout.on('data', (chunk) => {
                stdoutData += chunk.toString()
            })

            pipProcess.stderr.on('data', (chunk) => {
                stderrData += chunk.toString()
            })

            pipProcess.on('close', (exitCode) => {
                if (exitCode !== 0) {
                    node.status({fill:"red", shape:"dot", text:"Error"})
                    node.error(`Error ${exitCode}: ` + stderrData)
                } else {
                    msg.payload = stdoutData
                    node.send(msg)
                    node.status({})
                }
            })
        })
    }
    RED.nodes.registerType('pip',Pip)
}
