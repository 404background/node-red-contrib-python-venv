module.exports = function (RED) {
  function Venv(config) {
    RED.nodes.createNode(this, config)
    const node = this
    this.venvconfig = RED.nodes.getNode(config.venvconfig)

    if (!this.venvconfig) {
      node.send({ payload: 'Missing virtual environment configuration' })
      return
    }

    const fs = require('fs')
    const path = require('path')
    const child_process = require('child_process')

    node.status({ fill: 'green', shape: 'dot', text: 'Standby' })
    let runningScripts = 0

    let jsonPath = path.join(
      path.dirname(__dirname),
      this.venvconfig.venvname,
      'path.json'
    )
    let filePath = path.join(
      path.dirname(__dirname),
      this.venvconfig.venvname,
      this.id + '.py'
    )
    if (path.isAbsolute(this.venvconfig.venvname)) {
      jsonPath = path.join(this.venvconfig.venvname, 'path.json')
      filePath = path.join(this.venvconfig.venvname, this.id + '.py')
    }
    const json = fs.readFileSync(jsonPath)
    const pythonPath = JSON.parse(json).NODE_PYENV_PYTHON

    node.on('input', function (msg) {
      runningScripts++
      node.status({
        fill: 'blue',
        shape: 'dot',
        text: `Script instances running: ${runningScripts}`,
      })

      let code = ''
      if (typeof config.code !== 'undefined' && config.code !== '') {
        code = config.code
      } else {
        code = msg.code ?? ''
      }
      fs.writeFileSync(filePath, code)

      const message = Buffer.from(JSON.stringify(msg)).toString('base64')
      const args = [
        '-c',
        `import base64;import json;msg=json.loads(base64.b64decode(r'${message}'));exec(open(r'${filePath}').read())`,
      ]
      const pythonProcess = child_process.spawn(pythonPath, args)
      let stdoutData = ''
      let stderrData = ''

      pythonProcess.on('message', console.log)

      pythonProcess.stdout.on('data', chunk => {
        stdoutData += chunk.toString()
      })

      pythonProcess.stderr.on('data', chunk => {
        stderrData += chunk.toString()
      })

      pythonProcess.on('close', exitCode => {
        runningScripts--
        if (exitCode !== 0) {
          node.status({ fill: 'red', shape: 'dot', text: 'Error' })
          node.error(`Error ${exitCode}: ` + stderrData)
        } else {
          msg.payload = stdoutData
          node.send(msg)
          if (runningScripts === 0) {
            node.status({ fill: 'green', shape: 'dot', text: 'Standby' })
          } else {
            node.status({
              fill: 'blue',
              shape: 'dot',
              text: `Script instances running: ${runningScripts}`,
            })
          }
        }

        stdoutData = ''
        stderrData = ''
      })
    })
  }
  RED.nodes.registerType('venv', Venv)
}
