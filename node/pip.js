const child_process = require('child_process')
const { splitPackageNames } = require('./lib/command-args')
const {
  statusReporter,
  resolveVenvForNode,
  legacySend,
  legacyDone,
  callOnce,
  messageDeriver,
  pickArgument,
  trackChildProcesses,
} = require('./lib/node-runtime')

module.exports = function (RED) {
  function Pip(config) {
    RED.nodes.createNode(this, config)
    const node = this
    const status = statusReporter(node, 'pip')

    const venvPaths = resolveVenvForNode(RED, node, config, status)
    if (!venvPaths) {
      return
    }

    // pip is run as a module of the venv interpreter, so it works in an
    // environment that has no pip executable (e.g. one made by `uv venv`) and
    // lets `install --upgrade pip` replace pip itself on Windows.
    const pythonPath = venvPaths.python
    const tail = config.tail || false

    // Stop any pip process still running when the node is closed.
    const activeProcesses = trackChildProcesses(node)

    node.on('input', function (msg, send, done) {
      // Node-RED 0.x compatibility
      send = legacySend(node, send)
      done = legacyDone(node, msg, done)

      let argument = pickArgument(config.arg, msg.payload)

      let args = []
      let runningText = ''
      switch (config.action) {
        case 'install':
        case 'uninstall': {
          const packages = splitPackageNames(argument)
          if (packages.length === 0) {
            status.key('red', 'error-argument')
            done('No argument provided')
            return
          }
          args =
            config.action === 'install'
              ? ['install', ...packages]
              : ['uninstall', '-y', ...packages]
          runningText =
            config.action === 'install' ? 'Installing ' : 'Uninstalling '
          break
        }
        case 'list':
          args = ['list']
          argument = ''
          runningText = 'Listing '
          break
        default:
          status.key('red', 'error')
          done(`Unknown pip command: ${config.action}`)
          return
      }

      status.text('blue', runningText + argument)

      let stdoutData = ''
      let stderrData = ''

      const pipProcess = child_process.spawn(pythonPath, ['-m', 'pip', ...args])
      activeProcesses.add(pipProcess)

      // 'error' and 'close' can both fire; only the first one completes the message.
      const finish = callOnce(err => {
        activeProcesses.delete(pipProcess)
        done(err)
      })

      /** Clone the incoming message and put `payload` on it. */
      const derivedMessage = messageDeriver(RED, msg)

      pipProcess.on('error', err => {
        status.key('red', 'error')
        finish(err)
      })

      pipProcess.stdout.on('data', chunk => {
        stdoutData += chunk.toString()

        // In sequential output mode, forward each completed line right away
        if (tail && stdoutData.endsWith('\n')) {
          send(derivedMessage(stdoutData))
          stdoutData = ''
        }
      })

      pipProcess.stderr.on('data', chunk => {
        stderrData += chunk.toString()
      })

      pipProcess.on('close', exitCode => {
        // Killed on request, which happens when the node is stopped. There is
        // no exit code to report and nothing went wrong, so stay quiet.
        if (pipProcess.killed) {
          status.clear()
          finish()
          return
        }

        if (exitCode !== 0) {
          status.key('red', 'error')
          finish(
            `Error ${exitCode}${stderrData === '' ? '' : `: ${stderrData}`}`
          )
          return
        }

        // In tail mode only the trailing partial line is left to send
        if (!tail || stdoutData !== '') {
          msg.payload = stdoutData
          send(msg)
        }
        status.clear()
        finish()
      })
    })
  }
  RED.nodes.registerType('pip', Pip)
}
