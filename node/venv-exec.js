const fs = require('fs')
const child_process = require('child_process')
const { parseArguments, resolveExecutable } = require('./lib/command-args')
const {
  statusReporter,
  resolveVenvForNode,
  legacySend,
  legacyDone,
  callOnce,
  messageDeriver,
  describeExit,
  pickArgument,
  trackChildProcesses,
  killAll,
} = require('./lib/node-runtime')

module.exports = function (RED) {
  function VenvExec(config) {
    RED.nodes.createNode(this, config)
    const node = this
    const status = statusReporter(node, 'venv-exec')

    const venvPaths = resolveVenvForNode(RED, node, config, status)
    if (!venvPaths) {
      return
    }

    const execDir = venvPaths.exec

    // Kill whatever is still running when the node is stopped.
    const activeProcesses = trackChildProcesses(node)

    status.key('green', 'standby')

    node.on('input', function (msg, send, done) {
      // Node-RED 0.x compatibility
      send = legacySend(node, send)
      done = legacyDone(node, msg, done)

      if (msg.terminate === true || msg.kill === true) {
        // Every process this node started is stopped, whichever message asked
        // for it. The exit handlers report the termination through `killed`.
        killAll(activeProcesses)
        done()
        return
      }

      if (config.mode === 'list') {
        fs.readdir(execDir, (err, files) => {
          if (err) {
            status.key('red', 'error')
            done(err)
            return
          }
          status.key('green', 'standby')
          msg.payload = files
          send(msg)
          done()
        })
        return
      }

      if (config.mode !== 'execute') {
        done(`Unknown mode: ${config.mode}`)
        return
      }

      if (typeof config.executable !== 'string' || config.executable === '') {
        status.key('red', 'error')
        done('No executable configured')
        return
      }

      let execPath
      try {
        execPath = resolveExecutable(execDir, config.executable)
      } catch (e) {
        status.key('red', 'error')
        done(e)
        return
      }

      const args = parseArguments(pickArgument(config.arguments, msg.payload))

      fs.access(execPath, fs.constants.F_OK, accessErr => {
        if (accessErr) {
          status.key('red', 'notFound')
          done(accessErr)
          return
        }

        let stdoutData = ''
        let stderrData = ''

        // Spawned without a shell so that spaces in the venv path are safe and
        // the arguments cannot be re-interpreted by the shell.
        const execProcess = child_process.spawn(execPath, args)
        activeProcesses.add(execProcess)

        // 'error' and 'close' can both fire; only the first one completes the message.
        const finish = callOnce(err => {
          activeProcesses.delete(execProcess)
          done(err)
        })

        status.key('blue', 'executing')

        execProcess.on('error', err => {
          status.key('red', 'error')
          finish(err)
        })

        execProcess.stdout.on('data', chunk => {
          stdoutData += chunk.toString()
        })

        execProcess.stderr.on('data', chunk => {
          stderrData += chunk.toString()
        })

        /** Clone the incoming message and put `payload` on it. */
        const derivedMessage = messageDeriver(RED, msg)

        // 'close' rather than 'exit', so that output written right before the
        // process ended is still part of stdoutData / stderrData.
        execProcess.on('close', (exitCode, signal) => {
          // Third output always reports how the process ended, like the exec node.
          const exitMessage = derivedMessage(describeExit(exitCode, signal))
          const stderrMessage =
            stderrData === '' ? null : derivedMessage(stderrData)

          // Terminated on request: report how it ended without raising an error.
          if (execProcess.killed) {
            status.key('yellow', 'terminated')
            send([null, stderrMessage, exitMessage])
            finish()
            return
          }

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

          status.key('green', 'standby')
          msg.payload = stdoutData
          send([msg, stderrMessage, exitMessage])
          finish()
        })
      })
    })
  }

  RED.nodes.registerType('venv-exec', VenvExec)
}
