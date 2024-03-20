module.exports = function(RED) {
    function Pip(config) {
        RED.nodes.createNode(this,config)
        let node = this

        node.on('input', function(msg) {
            const path = require('path')
            const pathPip = path.join(path.dirname(__dirname), 'pyenv/Scripts/pip.exe')
            let argument = ''
            let action = ''
            let command = ''

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
            command = pathPip + ' ' + action + ' ' + option + ' ' + argument

            let execSync = require('child_process').execSync
            msg.payload = String(execSync(command))
            node.send(msg)
        })
    }
    RED.nodes.registerType('pip',Pip)
}
