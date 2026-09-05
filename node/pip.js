const child_process = require('child_process')
const { readVenvPaths } = require('./lib/venv-paths')
const { splitPackageNames } = require('./lib/command-args')

module.exports = function (RED) {
  function Pip(config) {
    RED.nodes.createNode(this, config)
    const node = this
    node.venvconfig = RED.nodes.getNode(config.venvconfig)

    if (!node.venvconfig) {
      node.status({ fill: 'red', shape: 'dot', text: 'pip.error' })
      node.error('Missing virtual environment configuration')
      return
    }

    let venvPaths
    try {
      venvPaths = readVenvPaths(node.venvconfig.venvname)
    } catch (e) {
      node.status({ fill: 'red', shape: 'dot', text: 'pip.error' })
      node.error(e.message)
      return
    }

    const pipPath = venvPaths.pip
    const tail = config.tail || false
    const activeProcesses = new Set()

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

      let argument = ''
      if (typeof config.arg !== 'undefined' && config.arg !== '') {
        argument = String(config.arg)
      } else if (typeof msg.payload !== 'undefined' && msg.payload !== '') {
        argument = String(msg.payload)
      }

      let args = []
      let runningText = ''
      switch (config.action) {
        case 'install':
        case 'uninstall': {
          const packages = splitPackageNames(argument)
          if (packages.length === 0) {
            node.status({
              fill: 'red',
              shape: 'dot',
              text: 'pip.error-argument',
            })
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
          node.status({ fill: 'red', shape: 'dot', text: 'pip.error' })
          done(`Unknown pip command: ${config.action}`)
          return
      }

      node.status({
        fill: 'blue',
        shape: 'dot',
        text: runningText + argument,
      })

      let stdoutData = ''
      let stderrData = ''
      let finished = false

      const pipProcess = child_process.spawn(pipPath, args)
      activeProcesses.add(pipProcess)

      // 'error' and 'close' can both fire; only the first one completes the message.
      const finish = err => {
        if (finished) {
          return
        }
        finished = true
        activeProcesses.delete(pipProcess)
        done(err)
      }

      pipProcess.on('error', err => {
        node.status({ fill: 'red', shape: 'dot', text: 'pip.error' })
        finish(err)
      })

      pipProcess.stdout.on('data', chunk => {
        stdoutData += chunk.toString()

        // In sequential output mode, forward each completed line right away
        if (tail && stdoutData.endsWith('\n')) {
          send({ ...msg, payload: stdoutData })
          stdoutData = ''
        }
      })

      pipProcess.stderr.on('data', chunk => {
        stderrData += chunk.toString()
      })

      pipProcess.on('close', exitCode => {
        if (exitCode !== 0) {
          node.status({ fill: 'red', shape: 'dot', text: 'pip.error' })
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
        node.status({})
        finish()
      })
    })

    // Stop any pip process still running when the node is closed
    node.on('close', function (_removed, done) {
      for (const pipProcess of activeProcesses) {
        pipProcess.kill()
      }
      activeProcesses.clear()
      done()
    })
  }
  RED.nodes.registerType('pip', Pip)
}
