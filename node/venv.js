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
    const sanitize = str => str.replace(/[\\/:"'*?<>|()]+/g, '_')
    const baseName =
      this.name && this.name.trim() !== '' ? sanitize(this.name) : this.id
    const venvDir = path.isAbsolute(this.venvconfig.venvname)
      ? this.venvconfig.venvname
      : path.join(path.dirname(__dirname), this.venvconfig.venvname)

    const newFileName = `${baseName}-${this.id}.py`
    filePath = path.join(venvDir, newFileName)

    if (!fs.existsSync(jsonPath)) {
      node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
      node.error('Virtual environment is not ready. path.json not found.')
      return
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

      // Handle circular references in msg object
      const removeCircularReferences = obj => {
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

      // Checks if the continuous flag is set and if so then kill the process and set it to undefined.
      // If terminate is set to true return without starting a new continuous process.
      if (continuous && (msg.terminate === true || msg.kill === true)) {
        pythonProcess?.kill()
        return
      }

      let code = ''
      if (typeof config.code !== 'undefined' && config.code !== '') {
        code = config.code
      } else {
        code = msg.code ?? ''
      }
      fs.writeFileSync(filePath, code, { encoding: 'utf-8' })

      const args = ['-c']
      const tempDir = path.join(venvDir, 'Temp')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      const tempMsgPath = path.join(tempDir, `${node.id}_msg.json`)
      const tempMsgOutputPath = path.join(tempDir, `${node.id}_msg_out.json`)
      const tempFlowOutputPath = path.join(tempDir, `${node.id}_flow_out.json`)
      const tempGlobalOutputPath = path.join(
        tempDir,
        `${node.id}_global_out.json`
      )

      // Remove stale output files from previous runs to avoid reading old data on error
      try {
        fs.unlinkSync(tempMsgOutputPath)
      } catch (_) {}
      try {
        fs.unlinkSync(tempFlowOutputPath)
      } catch (_) {}
      try {
        fs.unlinkSync(tempGlobalOutputPath)
      } catch (_) {}

      fs.writeFileSync(tempMsgPath, removeCircularReferences(msg), {
        encoding: 'utf-8',
      })

      const flowRegex = /node\[['"]flow['"]\]/
      const globalRegex = /node\[['"]global['"]\]/

      let pythonScript =
        `import json\n` +
        `with open(r'${tempMsgPath}', 'r', encoding='utf-8') as msg_file:\n` +
        `    msg = json.load(msg_file)\n` +
        `node = {'flow': {}, 'global': {}}\n`

      const tempFlowPath = path.join(tempDir, `${node.id}_flow.json`)
      const tempGlobalPath = path.join(tempDir, `${node.id}_global.json`)

      const usesFlowContext = flowRegex.test(code)
      const usesGlobalContext = globalRegex.test(code)

      if (usesFlowContext) {
        const flowData = flowContext.keys().reduce((obj, key) => {
          obj[key] = flowContext.get(key)
          return obj
        }, {})
        if (Object.keys(flowData).length > 0) {
          fs.writeFileSync(tempFlowPath, JSON.stringify(flowData), {
            encoding: 'utf-8',
          })
          pythonScript +=
            `with open(r'${tempFlowPath}', 'r', encoding='utf-8') as flow_file:\n` +
            `    node['flow'] = json.load(flow_file)\n`
        }
      }

      if (usesGlobalContext) {
        const globalData = globalContext.keys().reduce((obj, key) => {
          obj[key] = globalContext.get(key)
          return obj
        }, {})
        if (Object.keys(globalData).length > 0) {
          fs.writeFileSync(tempGlobalPath, JSON.stringify(globalData), {
            encoding: 'utf-8',
          })
          pythonScript +=
            `with open(r'${tempGlobalPath}', 'r', encoding='utf-8') as global_file:\n` +
            `    node['global'] = json.load(global_file)\n`
        }
      }

      pythonScript += `exec(open(r'${filePath}', encoding='utf-8').read())\n`

      // Write back msg after execution
      pythonScript +=
        `try:\n` +
        `    with open(r'${tempMsgOutputPath}', 'w', encoding='utf-8') as _msg_out:\n` +
        `        json.dump(msg, _msg_out, default=str)\n` +
        `except Exception:\n` +
        `    pass\n`

      if (usesFlowContext) {
        pythonScript +=
          `try:\n` +
          `    with open(r'${tempFlowOutputPath}', 'w', encoding='utf-8') as _flow_out:\n` +
          `        json.dump(node['flow'], _flow_out, default=str)\n` +
          `except Exception:\n` +
          `    pass\n`
      }

      if (usesGlobalContext) {
        pythonScript +=
          `try:\n` +
          `    with open(r'${tempGlobalOutputPath}', 'w', encoding='utf-8') as _global_out:\n` +
          `        json.dump(node['global'], _global_out, default=str)\n` +
          `except Exception:\n` +
          `    pass\n`
      }

      args.push(pythonScript)

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
      pythonProcess.on('error', err => {
        node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
        if (done) {
          done(err)
        } else {
          node.error(err)
        }
      })
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
        } else {
          // Read back msg properties set in Python
          try {
            if (fs.existsSync(tempMsgOutputPath)) {
              const outputMsg = JSON.parse(
                fs.readFileSync(tempMsgOutputPath, 'utf-8')
              )
              for (const [key, value] of Object.entries(outputMsg)) {
                msg[key] = value
              }
            }
          } catch (e) {
            /* ignore read errors */
          }

          // Read back flow context set in Python
          if (usesFlowContext) {
            try {
              if (fs.existsSync(tempFlowOutputPath)) {
                const flowData = JSON.parse(
                  fs.readFileSync(tempFlowOutputPath, 'utf-8')
                )
                for (const [key, value] of Object.entries(flowData)) {
                  flowContext.set(key, value)
                }
              }
            } catch (e) {
              /* ignore read errors */
            }
          }

          // Read back global context set in Python
          if (usesGlobalContext) {
            try {
              if (fs.existsSync(tempGlobalOutputPath)) {
                const globalData = JSON.parse(
                  fs.readFileSync(tempGlobalOutputPath, 'utf-8')
                )
                for (const [key, value] of Object.entries(globalData)) {
                  globalContext.set(key, value)
                }
              }
            } catch (e) {
              /* ignore read errors */
            }
          }

          if (!continuous) {
            runningScripts--

            // Backward compat: stdout overrides msg.payload if non-empty
            if (stdoutData) {
              msg.payload = stdoutData
            }
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
          }
          // In continuous mode, check if the process was killed or if it has exited cleanly
          else if (pythonProcess.killed) {
            node.status({
              fill: 'yellow',
              shape: 'dot',
              text: 'venv.terminate-continuous',
            })
          } else {
            node.status({
              fill: 'green',
              shape: 'dot',
              text: 'venv.standby',
            })
          }
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
