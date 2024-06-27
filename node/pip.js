module.exports = function(RED) {
    function Pip(config) {
        RED.nodes.createNode(this,config)
        let node = this
        let argument = ''
        let action = ''
        let command = ''
        const path = require('path')
        const fs = require('fs')
        const jsonPath = path.join(path.dirname(__dirname), 'path.json')
        const json = fs.readFileSync(jsonPath)
        const pathPip = JSON.parse(json).NODE_PYENV_PIP
        const execSync = require('child_process').execSync

        node.on('input', function(msg) {
            if(config.arg !== null && config.arg !== '') {
                argument = config.arg
            } else {
                argument = msg.payload
            }

            switch(config.action) {
                case 'install':
                    action = 'install'
                    option =  ''
                    break
                case 'uninstall':
                    action = 'uninstall'
                    option =  '-y'
                    break
                case 'list':
                    action = 'list'
                    option =  ''
                    argument = ''
                    break
                default:
                    action = ''
                    option = ''
                    break
            }
            
            if(action !== '') {
                node.status({fill:"blue",shape:"dot",text:`${config.action}ing`})
            }
 
            command = pathPip + ' ' + action + ' ' + option + ' ' + argument
            msg.payload = String(execSync(command))
            node.send(msg)
            node.status({})
        })
    }
    RED.nodes.registerType('pip',Pip)
}
