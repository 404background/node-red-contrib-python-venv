const fs = require('fs')
const child_process = require('child_process')
const { readVenvPaths } = require('./lib/venv-paths')
const { parseArguments, resolveExecutable } = require('./lib/command-args')

module.exports = function (RED) {
  function VenvExec(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.venvconfig = RED.nodes.getNode(config.venvconfig)

    if (!node.venvconfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
      node.error('Missing virtual environment configuration')
      return
    }

    let venvPaths
    try {
      venvPaths = readVenvPaths(node.venvconfig.venvname)
    } catch (e) {
      node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
      node.error(e.message)
      return
    }

    const execDir = venvPaths.exec
    let currentProcess = null

    node.status({ fill: 'green', shape: 'dot', text: 'venv-exec.standby' })

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

      if (msg.terminate === true || msg.kill === true) {
        if (currentProcess) {
          // Flag lives on the process so that the exit handler of the process
          // being killed sees it, whichever message asked for the kill.
          currentProcess.terminatedByRequest = true
          currentProcess.kill()
        }
        done()
        return
      }

      if (config.mode === 'list') {
        fs.readdir(execDir, (err, files) => {
          if (err) {
            node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
            done(err)
            return
          }
          node.status({
            fill: 'green',
            shape: 'dot',
            text: 'venv-exec.standby',
          })
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
        node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
        done('No executable configured')
        return
      }

      let execPath
      try {
        execPath = resolveExecutable(execDir, config.executable)
      } catch (e) {
        node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
        done(e)
        return
      }

      let argument = ''
      if (typeof config.arguments !== 'undefined' && config.arguments !== '') {
        argument = String(config.arguments)
      } else if (typeof msg.payload !== 'undefined' && msg.payload !== '') {
        argument = String(msg.payload)
      }
      const args = parseArguments(argument)

      fs.access(execPath, fs.constants.F_OK, accessErr => {
        if (accessErr) {
          node.status({
            fill: 'red',
            shape: 'dot',
            text: 'venv-exec.notFound',
          })
          done(accessErr)
          return
        }

        let stdoutData = ''
        let stderrData = ''
        let finished = false

        // Spawned without a shell so that spaces in the venv path are safe and
        // the arguments cannot be re-interpreted by the shell.
        const execProcess = child_process.spawn(execPath, args)
        currentProcess = execProcess

        // 'error' and 'exit' can both fire; only the first one completes the message.
        const finish = err => {
          if (finished) {
            return
          }
          finished = true
          if (currentProcess === execProcess) {
            currentProcess = null
          }
          done(err)
        }

        node.status({
          fill: 'blue',
          shape: 'dot',
          text: 'venv-exec.executing',
        })

        execProcess.on('error', err => {
          node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
          finish(err)
        })

        execProcess.stdout.on('data', chunk => {
          stdoutData += chunk.toString()
        })

        execProcess.stderr.on('data', chunk => {
          stderrData += chunk.toString()
        })

        /** Clone the incoming message and put `payload` on it. */
        const derivedMessage = payload => {
          const copy = RED.util.cloneMessage(msg)
          copy.payload = payload
          return copy
        }

        execProcess.on('exit', (exitCode, signal) => {
          // Third output always reports how the process ended, like the exec node.
          const exitPayload = { code: exitCode }
          if (signal !== null) {
            exitPayload.signal = signal
          }
          const exitMessage = derivedMessage(exitPayload)
          const stderrMessage =
            stderrData === '' ? null : derivedMessage(stderrData)

          if (execProcess.terminatedByRequest) {
            node.status({
              fill: 'yellow',
              shape: 'dot',
              text: 'venv-exec.terminate-continuous',
            })
            send([null, stderrMessage, exitMessage])
            finish()
            return
          }

          if (signal === null && exitCode !== 0) {
            node.status({ fill: 'red', shape: 'dot', text: 'venv-exec.error' })
            // The first output stays quiet on failure so that flows which treat
            // an incoming message as success keep working.
            send([null, stderrMessage, exitMessage])
            finish(
              `Error ${exitCode}${stderrData === '' ? '' : `: ${stderrData}`}`
            )
            return
          }

          node.status({
            fill: 'green',
            shape: 'dot',
            text: 'venv-exec.standby',
          })
          msg.payload = stdoutData
          send([msg, stderrMessage, exitMessage])
          finish()
        })
      })
    })

    // Stop a process still running when the node is closed
    node.on('close', function (_removed, done) {
      if (currentProcess) {
        currentProcess.terminatedByRequest = true
        currentProcess.kill()
        currentProcess = null
      }
      done()
    })
  }

  RED.nodes.registerType('venv-exec', VenvExec)
}
