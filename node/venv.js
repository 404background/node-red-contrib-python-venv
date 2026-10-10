const fs = require('fs')
const path = require('path')
const child_process = require('child_process')
const {
  sanitizeBaseName,
  usesFlowContext,
  usesGlobalContext,
  stringifyWithoutCircularReferences,
  readContext,
  writeChangedContext,
  buildBootstrapScript,
} = require('./lib/python-bridge')
const {
  statusReporter,
  whenVenvReady,
  legacySend,
  legacyDone,
  callOnce,
  messageDeriver,
  describeExit,
  trackChildProcesses,
  killAll,
} = require('./lib/node-runtime')

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
    const status = statusReporter(node, 'venv')

    const sanitizedName = node.name ? sanitizeBaseName(node.name) : ''
    const baseName = sanitizedName !== '' ? sanitizedName : node.id

    let pythonPath = null
    let tempDir = null
    let editorScriptPath = null
    const venvReady = whenVenvReady(RED, node, config, status).then(
      venvPaths => {
        if (venvPaths) {
          pythonPath = venvPaths.python
          tempDir = path.join(venvPaths.venvDir, 'Temp')
          editorScriptPath = path.join(
            venvPaths.venvDir,
            `${baseName}-${node.id}.py`
          )
          status.key('green', 'standby')
        }
        return venvPaths
      }
    )

    const continuous = config.continuous || false
    const runningText = 'Running: '

    let runningScripts = 0
    let runCounter = 0
    let pythonProcess = undefined

    // Kill whatever is still running when the node is stopped.
    const activeProcesses = trackChildProcesses(node, child => {
      if (pythonProcess === child) {
        pythonProcess = undefined
      }
    })

    node.standby = true

    function updateStatusAfterRun() {
      if (runningScripts > 0) {
        status.text('blue', runningText + runningScripts)
      } else {
        status.key('green', 'standby')
      }
    }

    node.on('input', async function (msg, send, done) {
      // Node-RED 0.x compatibility
      send = legacySend(node, send)
      done = legacyDone(node, msg, done)

      // Terminate the running script(s) instead of starting another one.
      if (msg.terminate === true || msg.kill === true) {
        killAll(activeProcesses)
        done()
        return
      }

      // Without an environment there is nothing to run; the reason has
      // already been reported on the node.
      if (!(await venvReady)) {
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

      const hasEditorCode =
        typeof config.code !== 'undefined' && config.code !== ''
      const code = hasEditorCode ? config.code : (msg.code ?? '')

      const withFlow = usesFlowContext(code)
      const withGlobal = usesGlobalContext(code)
      const flowContext = node.context().flow
      const globalContext = node.context().global

      // Unique per invocation so concurrent messages cannot read each other's data.
      const runId = `${node.id}_${++runCounter}`
      const io = {
        // Code from the editor is the same for every message and keeps its
        // readable file name. Code carried by the message differs per run, so
        // it gets a private file that is cleaned up with the other run files.
        script: hasEditorCode
          ? editorScriptPath
          : path.join(tempDir, `${runId}.py`),
        msg: path.join(tempDir, `${runId}_msg.json`),
        msgOut: path.join(tempDir, `${runId}_msg_out.json`),
      }

      const tempFiles = [io.msg, io.msgOut]
      if (!hasEditorCode) {
        tempFiles.push(io.script)
      }
      if (withFlow) {
        io.flow = path.join(tempDir, `${runId}_flow.json`)
        io.flowOut = path.join(tempDir, `${runId}_flow_out.json`)
        tempFiles.push(io.flow, io.flowOut)
      }
      if (withGlobal) {
        io.global = path.join(tempDir, `${runId}_global.json`)
        io.globalOut = path.join(tempDir, `${runId}_global_out.json`)
        tempFiles.push(io.global, io.globalOut)
      }

      const cleanUpTempFiles = () => {
        for (const filePath of tempFiles) {
          removeFileQuietly(filePath)
        }
      }

      // Keep original snapshots so only genuinely modified keys are written back.
      let originalFlow = {}
      let originalGlobal = {}

      try {
        fs.mkdirSync(tempDir, { recursive: true })
        fs.writeFileSync(io.script, code, { encoding: 'utf-8' })
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
        status.key('red', 'error')
        done(e)
        return
      }

      const args = []
      if (continuous) {
        // Disable stdout and stderr buffering
        args.push('-u')
        status.key('blue', 'running-continuous')
      } else {
        runningScripts++
        status.text('blue', runningText + runningScripts)
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

      const child = child_process.spawn(pythonPath, args, { env })
      pythonProcess = child
      activeProcesses.add(child)

      // 'error' and 'close' can both fire; only the first one completes the message.
      const finish = callOnce(err => {
        activeProcesses.delete(child)
        if (pythonProcess === child) {
          pythonProcess = undefined
        }
        cleanUpTempFiles()
        node.standby = true
        done(err)
      })

      /** Clone the incoming message and put `payload` on it. */
      const derivedMessage = messageDeriver(RED, msg)

      child.on('error', err => {
        if (!continuous) {
          runningScripts--
        }
        status.key('red', 'error')
        finish(err)
      })

      child.stdout.on('data', chunk => {
        stdoutData += chunk.toString('utf8')
        // In continuous mode, forward the output as soon as a line is complete
        if (continuous && stdoutData.endsWith('\n')) {
          send([derivedMessage(stdoutData), null, null])
          stdoutData = ''
        }
      })

      child.stderr.on('data', chunk => {
        const err = chunk.toString('utf8')
        stderrData += err
        rollingStderrData += err
        // In continuous mode, forward stderr as soon as a line is complete
        if (continuous && rollingStderrData.endsWith('\n')) {
          send([null, derivedMessage(rollingStderrData), null])
          rollingStderrData = ''
        }
      })

      // 'close' rather than 'exit', so that output written right before the
      // process ended is still part of stdoutData / stderrData.
      child.on('close', (exitCode, signal) => {
        if (!continuous) {
          runningScripts--
        }

        // Read back msg properties set in Python. When the script aborted, the
        // write back never ran and there is simply nothing to read.
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

        // Third output always reports how the process ended, like the exec node.
        const exitMessage = derivedMessage(describeExit(exitCode, signal))

        // Flush output that was not newline terminated
        const stderrMessage =
          rollingStderrData === '' ? null : derivedMessage(rollingStderrData)
        rollingStderrData = ''
        const stdoutTail = stdoutData
        stdoutData = ''

        if (continuous) {
          send([
            stdoutTail === '' ? null : derivedMessage(stdoutTail),
            stderrMessage,
            exitMessage,
          ])
          // A restart has already put the status of its own process up.
          if (pythonProcess === child) {
            if (child.killed) {
              status.key('yellow', 'terminate-continuous')
            } else {
              status.key('green', 'standby')
            }
          }
          finish()
          return
        }

        // Terminated on request: report how it ended without raising an error.
        if (child.killed) {
          status.key('yellow', 'terminated')
          send([null, stderrMessage, exitMessage])
          finish()
          return
        }

        // A null signal with a non-zero code means the script itself failed.
        if (signal === null && exitCode !== 0) {
          status.key('red', 'error')
          // The first output stays quiet on failure so that flows which treat
          // an incoming message as success keep working.
          send([null, stderrMessage, exitMessage])
          finish(
            `Error ${exitCode}${stderrData === '' ? '' : `: ${stderrData}`}`
          )
          return
        }

        // Backward compat: stdout overrides msg.payload if non-empty
        if (stdoutTail) {
          msg.payload = stdoutTail
        }
        send([msg, stderrMessage, exitMessage])
        updateStatusAfterRun()

        finish()
      })
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
