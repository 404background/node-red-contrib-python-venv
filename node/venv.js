const fs = require('fs')
const path = require('path')
const child_process = require('child_process')
const { readVenvPaths } = require('./lib/venv-paths')
const {
  sanitizeBaseName,
  usesFlowContext,
  usesGlobalContext,
  stringifyWithoutCircularReferences,
  readContext,
  writeChangedContext,
  buildBootstrapScript,
} = require('./lib/python-bridge')

function removeFileQuietly(filePath) {
  try {
    fs.unlinkSync(filePath)
  } catch (_e) {
    // Missing or locked file: nothing to clean up.
  }
}

function readJsonFileOrNull(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (_e) {
    return null
  }
}

module.exports = function (RED) {
  function Venv(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.venvconfig = RED.nodes.getNode(config.venvconfig)

    if (!node.venvconfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
      node.error('Missing virtual environment configuration')
      return
    }

    let venvPaths
    try {
      venvPaths = readVenvPaths(node.venvconfig.venvname)
    } catch (e) {
      node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
      node.error(e.message)
      return
    }

    const venvDir = venvPaths.venvDir
    const pythonPath = venvPaths.python
    const tempDir = path.join(venvDir, 'Temp')

    const sanitizedName = node.name ? sanitizeBaseName(node.name) : ''
    const baseName = sanitizedName !== '' ? sanitizedName : node.id
    const scriptPath = path.join(venvDir, `${baseName}-${node.id}.py`)

    const continuous = config.continuous || false
    const runningText = 'Running: '

    let runningScripts = 0
    let runCounter = 0
    let pythonProcess = undefined
    const activeProcesses = new Set()

    node.standby = true
    node.status({ fill: 'green', shape: 'dot', text: 'venv.standby' })

    function updateStatusAfterRun() {
      if (runningScripts > 0) {
        node.status({
          fill: 'blue',
          shape: 'dot',
          text: runningText + runningScripts,
        })
      } else {
        node.status({ fill: 'green', shape: 'dot', text: 'venv.standby' })
      }
    }

    node.on('input', function (msg, send, done) {
      // Node-RED 0.x compatibility
      send = send || node.send.bind(node)
      done =
        done ||
        function (err) {
          if (err) {
            node.error(err, msg)
          }
        }

      // Terminate the running continuous process instead of starting a new one.
      if (continuous && (msg.terminate === true || msg.kill === true)) {
        if (pythonProcess) {
          pythonProcess.kill()
        }
        done()
        return
      }

      // A continuous process is a singleton per node: replace the previous one
      // rather than leaking it by overwriting the reference.
      if (continuous && pythonProcess && pythonProcess.exitCode === null) {
        node.warn('Restarting the running continuous process.')
        pythonProcess.kill()
      }

      node.standby = false

      const code =
        typeof config.code !== 'undefined' && config.code !== ''
          ? config.code
          : (msg.code ?? '')

      const withFlow = usesFlowContext(code)
      const withGlobal = usesGlobalContext(code)
      const flowContext = node.context().flow
      const globalContext = node.context().global

      // Unique per invocation so concurrent messages cannot read each other's data.
      const runId = `${node.id}_${++runCounter}`
      const io = {
        script: scriptPath,
        msg: path.join(tempDir, `${runId}_msg.json`),
        msgOut: path.join(tempDir, `${runId}_msg_out.json`),
      }
      if (withFlow) {
        io.flow = path.join(tempDir, `${runId}_flow.json`)
        io.flowOut = path.join(tempDir, `${runId}_flow_out.json`)
      }
      if (withGlobal) {
        io.global = path.join(tempDir, `${runId}_global.json`)
        io.globalOut = path.join(tempDir, `${runId}_global_out.json`)
      }

      const tempKeys = [
        'msg',
        'msgOut',
        'flow',
        'flowOut',
        'global',
        'globalOut',
      ]
      const cleanUpTempFiles = () => {
        for (const key of tempKeys) {
          if (io[key]) {
            removeFileQuietly(io[key])
          }
        }
      }

      // Keep original snapshots so only genuinely modified keys are written back.
      let originalFlow = {}
      let originalGlobal = {}

      try {
        fs.mkdirSync(tempDir, { recursive: true })
        fs.writeFileSync(scriptPath, code, { encoding: 'utf-8' })
        fs.writeFileSync(io.msg, stringifyWithoutCircularReferences(msg), {
          encoding: 'utf-8',
        })

        if (withFlow) {
          originalFlow = readContext(flowContext)
          if (Object.keys(originalFlow).length > 0) {
            fs.writeFileSync(io.flow, JSON.stringify(originalFlow), {
              encoding: 'utf-8',
            })
          } else {
            delete io.flow
          }
        }
        if (withGlobal) {
          originalGlobal = readContext(globalContext)
          if (Object.keys(originalGlobal).length > 0) {
            fs.writeFileSync(io.global, JSON.stringify(originalGlobal), {
              encoding: 'utf-8',
            })
          } else {
            delete io.global
          }
        }
      } catch (e) {
        cleanUpTempFiles()
        node.standby = true
        node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
        done(e)
        return
      }

      const args = []
      if (continuous) {
        // Disable stdout and stderr buffering
        args.push('-u')
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
      args.push('-c', buildBootstrapScript(withFlow, withGlobal))

      const env = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        NODE_RED_VENV_IO: JSON.stringify(io),
      }

      let stdoutData = ''
      let stderrData = ''
      let rollingStderrData = ''
      let finished = false

      const child = child_process.spawn(pythonPath, args, { env })
      pythonProcess = child
      activeProcesses.add(child)

      // 'error' and 'exit' can both fire; only the first one completes the message.
      const finish = err => {
        if (finished) {
          return
        }
        finished = true
        activeProcesses.delete(child)
        if (pythonProcess === child) {
          pythonProcess = undefined
        }
        cleanUpTempFiles()
        node.standby = true
        done(err)
      }

      child.on('error', err => {
        if (!continuous) {
          runningScripts--
        }
        node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
        finish(err)
      })

      child.stdout.on('data', chunk => {
        stdoutData += chunk.toString('utf8')
        // In continuous mode, forward the output as soon as a line is complete
        if (continuous && stdoutData.endsWith('\n')) {
          send({ ...msg, payload: stdoutData })
          stdoutData = ''
        }
      })

      child.stderr.on('data', chunk => {
        const err = chunk.toString('utf8')
        stderrData += err
        rollingStderrData += err
        // In continuous mode, report errors as soon as a line is complete
        if (continuous && rollingStderrData.endsWith('\n')) {
          node.error(rollingStderrData, msg)
          rollingStderrData = ''
        }
      })

      child.on('exit', (exitCode, signal) => {
        if (!continuous) {
          runningScripts--
        }

        // A null signal with a non-zero code means the script itself failed.
        if (signal === null && exitCode !== 0) {
          node.status({ fill: 'red', shape: 'dot', text: 'venv.error' })
          finish(
            `Error ${exitCode}${stderrData === '' ? '' : `: ${stderrData}`}`
          )
          return
        }

        // Read back msg properties set in Python
        const outputMsg = readJsonFileOrNull(io.msgOut)
        if (outputMsg !== null && typeof outputMsg === 'object') {
          Object.assign(msg, outputMsg)
        }

        if (withFlow) {
          const flowData = readJsonFileOrNull(io.flowOut)
          if (flowData !== null && typeof flowData === 'object') {
            writeChangedContext(flowContext, flowData, originalFlow)
          }
        }
        if (withGlobal) {
          const globalData = readJsonFileOrNull(io.globalOut)
          if (globalData !== null && typeof globalData === 'object') {
            writeChangedContext(globalContext, globalData, originalGlobal)
          }
        }

        if (!continuous) {
          // Backward compat: stdout overrides msg.payload if non-empty
          if (stdoutData) {
            msg.payload = stdoutData
          }
          send(msg)
          updateStatusAfterRun()
        } else {
          // Flush output that was not newline terminated
          if (stdoutData) {
            send({ ...msg, payload: stdoutData })
            stdoutData = ''
          }
          if (rollingStderrData) {
            node.error(rollingStderrData, msg)
            rollingStderrData = ''
          }
          node.status(
            child.killed
              ? {
                  fill: 'yellow',
                  shape: 'dot',
                  text: 'venv.terminate-continuous',
                }
              : { fill: 'green', shape: 'dot', text: 'venv.standby' }
          )
        }

        finish()
      })
    })

    // Clean up any python process still running when the node is stopped
    node.on('close', function (_removed, done) {
      for (const child of activeProcesses) {
        child.kill()
      }
      activeProcesses.clear()
      pythonProcess = undefined
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
