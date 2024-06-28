module.exports = function(RED) {
    function venvConfig(config) {
        RED.nodes.createNode(this, config)
    }
    RED.nodes.registerType("venv-config",venvConfig)
}
