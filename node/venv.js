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

    const continuous = config.continuous || false

    let pythonProcess = undefined
    node.standby = true
    node.on('input', function (msg, send, done) {
      node.standby = false

      // Checks if the continuous flag is set and if so then kill the process and set it to undefined.
      // If terminate is set to true return without starting a new continuous process.
      if (continuous) {
        pythonProcess?.kill()
        if (msg.terminate === true) {
          return
        }
      }

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

      let stdoutData = ''
      let stderrData = ''
      let rollingStderrData = ''

      if (continuous) {
        // Disable stdout and stderr buffering
        args.unshift('-u')
        node.status({
          fill: 'blue',
          shape: 'dot',
          text: `Script running in continuous mode`,
        })
      } else {
        runningScripts++
        node.status({
          fill: 'blue',
          shape: 'dot',
          text: `Script instances running: ${runningScripts}`,
        })
      }

      pythonProcess = child_process.spawn(pythonPath, args)

      pythonProcess.on('message', console.log)

      pythonProcess.stdout.on('data', chunk => {
        stdoutData += chunk.toString()

        // In continuous mode, send the output line by line
        if (continuous && stdoutData.endsWith('\n')) {
          msg.payload = stdoutData
          send(msg)
          stdoutData = ''
        }
      })

      pythonProcess.stderr.on('data', chunk => {
        const err = chunk.toString()
        stderrData += err
        rollingStderrData += err
        // In continuous mode, send errors line by line
        if (continuous && rollingStderrData.endsWith('\n')) {
          node.error(rollingStderrData)
          rollingStderrData = ''
        }
      })

      pythonProcess.on('exit', (code, signal) => {
        // If signal is null and the exit code is not 0, then the process exited with an error
        if (signal === null && code !== 0) {
          node.status({ fill: 'red', shape: 'dot', text: 'Error' })
          const err = `Error ${code}${
            stderrData === '' ? '' : `: ${stderrData}`
          }`
          if (done) {
            done(err)
          } else {
            node.error(err)
          }
        }
        // Single mode, send the output
        else if (!continuous) {
          runningScripts--
          msg.payload = stdoutData
          send(msg)
          if (runningScripts === 0) {
            node.status({
              fill: 'green',
              shape: 'dot',
              text: 'Standby',
            })
          } else {
            node.status({
              fill: 'blue',
              shape: 'dot',
              text: `Script instances running: ${runningScripts}`,
            })
          }
          node.standby = true
        }
        // In continuous mode, check if the process was killed or if it has exited cleanly
        else if (pythonProcess.killed) {
          node.status({
            fill: 'yellow',
            shape: 'dot',
            text: 'Continuously running script terminated',
          })
          node.standby = true
        } else if (code === 0) {
          node.status({
            fill: 'green',
            shape: 'dot',
            text: 'Standby',
          })
          node.standby = true
        }

        done()
      })
    })
    // Clean up the python process on node close
    this.on('close', function (_removed, done) {
      if (pythonProcess) {
        pythonProcess.kill()
      }
      done()
    })
  }

  // React to the node button click
  RED.httpAdmin.post(
    '/venv/:id',
    RED.auth.needsPermission('venv.write'),
    function (req, res) {
      const node = RED.nodes.getNode(req.params.id)
      if (node !== null && typeof node !== 'undefined') {
        node.receive({ terminate: !node.standby })
        res.sendStatus(200)
      } else {
        res.sendStatus(404)
      }
    }
  )
  RED.nodes.registerType('venv', Venv)
}
