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

    node.status({ fill: 'green', shape: 'dot', text: 'venv.standby' })
    const runningText = 'Running: '
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
      const flowContext = node.context().flow
      const globalContext = node.context().global

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
      fs.writeFileSync(filePath, code, { encoding: 'utf-8' })

      // Handle circular references in msg object
      const removeCircularReferences = (obj) => {
        const seen = new WeakSet()
        return JSON.stringify(obj, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return // Skip circular references
            }
            seen.add(value)
          }
          return value
        })
      }

      const message = Buffer.from(removeCircularReferences(msg)).toString('base64')
      const flowMessage = Buffer.from(JSON.stringify(
        flowContext.keys().reduce((obj, key) => {
          obj[key] = flowContext.get(key)
          return obj
        }, {})
      )).toString('base64')
      
      const globalMessage = Buffer.from(JSON.stringify(
        globalContext.keys().reduce((obj, key) => {
          obj[key] = globalContext.get(key)
          return obj
        }, {})
      )).toString('base64')

      const args = [
        '-c',
        `import base64; \
        import json; \
        node = { 'flow': '', 'global': ''}; \
        msg=json.loads(base64.b64decode(r'${message}').decode('utf-8')); \
        node['flow']=json.loads(base64.b64decode(r'${flowMessage}').decode('utf-8')); \
        node['global']=json.loads(base64.b64decode(r'${globalMessage}').decode('utf-8')); \
        exec(open(r'${filePath}', encoding='utf-8').read())`,
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
          text: 'venv.running-continuous',
        })
      } else {
        runningScripts++
        node.status({
          fill: 'blue',
          shape: 'dot',
          text: runningText + runningScripts,
        })
      }

      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      pythonProcess = child_process.spawn(pythonPath, args, { env })
      pythonProcess.on('message', console.log)

      pythonProcess.stdout.on('data', chunk => {
        stdoutData += chunk.toString('utf8')
        // In continuous mode, send the output line by line
        if (continuous && stdoutData.endsWith('\n')) {
          msg.payload = stdoutData
          send(msg)
          stdoutData = ''
        }
      })

      pythonProcess.stderr.on('data', chunk => {
        const err = chunk.toString('utf8')
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
          node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
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
              text: 'venv.standby',
            })
          } else {
            node.status({
              fill: 'blue',
              shape: 'dot',
              text: runningText + runningScripts,
            })
          }
          node.standby = true
        }
        // In continuous mode, check if the process was killed or if it has exited cleanly
        else if (pythonProcess.killed) {
          node.status({
            fill: 'yellow',
            shape: 'dot',
            text: 'venv.terminate-continuous',
          })
          node.standby = true
        } else if (code === 0) {
          node.status({
            fill: 'green',
            shape: 'dot',
            text: 'venv.standby',
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
