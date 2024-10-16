module.exports = function (RED) {
  const fs = require('fs')
  const path = require('path')
  const { spawn } = require('child_process')

  function VenvExec(config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.venvconfig = RED.nodes.getNode(config.venvconfig)
    this.mode = config.mode
    this.executable = config.executable
    this.arguments = config.arguments

    if (!this.venvconfig) {
      node.send({ payload: 'Missing virtual environment configuration' })
      return
    }
    let jsonPath = path.join(
      path.dirname(__dirname),
      this.venvconfig.venvname,
      'path.json'
    )
    if (path.isAbsolute(this.venvconfig.venvname)) {
      jsonPath = path.join(this.venvconfig.venvname, 'path.json')
    }
    const json = fs.readFileSync(jsonPath)
    const venvExec = JSON.parse(json).NODE_PYENV_EXEC
    node.status({ fill: 'green', shape: 'dot', text: 'Standby' })

    node.on('input', function (msg, send, done) {
      if (node.mode === 'list') {
        fs.readdir(venvExec, (err, files) => {
          if (err) {
            node.error('Error:', err)
            if (done) done(err)
            return
          }
          msg.payload = files
          send(msg)
          done()
        })
      } else if (node.mode === 'execute') {
        const execPath = path.join(venvExec, node.executable)
        const args = node.arguments.split(' ').filter(arg => arg)

        fs.access(execPath, fs.constants.F_OK, err => {
          if (err) {
            node.status({ fill: 'red', shape: 'dot', text: 'File not found' })
            node.error(`File not found: ${execPath}`)
            if (done) done(err)
            return
          }

          node.status({ fill: 'blue', shape: 'dot', text: 'Executing' })

          const child = spawn(execPath, args)

          let stdoutData = ''
          let stderrData = ''

          child.stdout.on('data', chunk => {
            stdoutData += chunk.toString()
          })

          child.stderr.on('data', chunk => {
            stderrData += chunk.toString()
          })

          child.on('exit', code => {
            if (code !== 0) {
              node.status({ fill: 'red', shape: 'dot', text: `Error: ${code}` })
              node.error(`Error: ${code}. ${stderrData}`)
              msg.payload = stderrData
            } else {
              node.status({ fill: 'green', shape: 'dot', text: 'Standby' })
              msg.payload = stdoutData
            }
            send(msg)
            done()
          })
        })
      }
    })
  }

  RED.nodes.registerType('venv-exec', VenvExec)
}
