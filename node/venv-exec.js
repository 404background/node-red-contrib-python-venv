module.exports = function (RED) {
  const fs = require('fs')
  const path = require('path')
  const child_process = require('child_process')

  function VenvExec(config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.venvconfig = RED.nodes.getNode(config.venvconfig)
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
    let execPath = ''
    let pythonProcess = null
    node.status({ fill: 'green', shape: 'dot', text: 'venv-exec.standby' })

    node.on('input', function (msg, send, done) {
      let terminated = false
      if (msg.terminate === true || msg.kill === true) {
        if (pythonProcess) {
          pythonProcess.kill()
          terminated = true
        }
        done()
        return
      }

      if (config.mode === 'list') {
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
      } else if (config.mode === 'execute') {
        let argument = ''
        if (
          typeof config.arguments !== 'undefined' &&
          config.arguments !== ''
        ) {
          argument = String(config.arguments)
        } else if (typeof msg.payload !== 'undefined' && msg.payload !== '') {
          argument = String(msg.payload)
        }
        const args = argument.replace(/'([^']+)'/g, '"$1"')

        if (
          typeof config.executable !== 'undefined' &&
          config.executable !== ''
        ) {
          execPath = path.join(venvExec, config.executable)
        } else {
          return
        }

        fs.access(execPath, fs.constants.F_OK, err => {
          if (err) {
            node.status({
              fill: 'red',
              shape: 'dot',
              text: 'venv-exec.notFound',
            })
            if (done) done(err)
            return
          }

          pythonProcess = child_process.spawn(execPath + ' ' + args, {
            shell: true,
          })
          let stdoutData = ''
          let stderrData = ''
          node.status({
            fill: 'blue',
            shape: 'dot',
            text: 'venv-exec.running-continuous'
          })

          pythonProcess.stdout.on('data', chunk => {
            stdoutData += chunk.toString()
          })

          pythonProcess.stderr.on('data', chunk => {
            stderrData += chunk.toString()
          })

          pythonProcess.on('exit', (code, signal) => {
            pythonProcess = null // Clear the reference
            if (terminated) {
              node.status({
                fill: 'yellow',
                shape: 'dot',
                text: 'venv-exec.terminate-continuous'
              })
              done()
              return
            }
            if (signal === null && code !== 0) {
              node.status({
                fill: 'red',
                shape: 'dot',
                text: 'venv-exec.error',
              })
              node.error(`Error: ${code}. ${stderrData}`)
              msg.payload = stderrData
            } else if (code === 0) {
              node.status({
                fill: 'green',
                shape: 'dot',
                text: 'venv-exec.standby',
              })
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
