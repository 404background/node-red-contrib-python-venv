module.exports = function (RED) {
  const path = require('path')
  const fs = require('fs')
  const { execSync, spawnSync } = require('child_process')

  /**
   * Check if python, venv module, and pip module are available.
   * Returns { python: bool, venv: bool, pip: bool, pythonCmd: string, details: string[] }
   */
  function checkPythonEnvironment(version) {
    const result = {
      python: false,
      venv: false,
      pip: false,
      pythonCmd: '',
      details: [],
    }

    // Determine python command and args for spawnSync
    let pythonCmd = 'python3'
    let spawnCmd = 'python3'
    let spawnArgs = []
    // On Windows, avoid shell: true to prevent cmd.exe from splitting -c arguments on spaces.
    // On Linux/macOS, use shell: true so PATH is resolved correctly (e.g. when running as a service).
    const useShell = process.platform !== 'win32'
    if (process.platform === 'win32') {
      if (version && version !== '' && version !== 'default') {
        pythonCmd = `py -${version}`
        spawnCmd = 'py'
        spawnArgs = [`-${version}`]
      } else {
        pythonCmd = 'python'
        spawnCmd = 'python'
      }
    }
    result.pythonCmd = pythonCmd

    // Check python
    try {
      const ver = spawnSync(spawnCmd, [...spawnArgs, '--version'], {
        shell: useShell,
        timeout: 10000,
      })
      if (ver.status === 0) {
        result.python = true
        result.details.push(ver.stdout.toString().trim())
      } else {
        result.details.push(`Python not found (command: ${pythonCmd})`)
        return result
      }
    } catch (e) {
      result.details.push(`Python not found (command: ${pythonCmd})`)
      return result
    }

    // Check venv module
    try {
      const venvCheck = spawnSync(
        spawnCmd,
        [...spawnArgs, '-c', 'import venv'],
        { shell: useShell, timeout: 10000 }
      )
      if (venvCheck.status === 0) {
        result.venv = true
      } else {
        if (process.platform === 'win32') {
          result.details.push(
            'venv module is not available. Please install Python from https://www.python.org/ (not the Microsoft Store version).'
          )
        } else {
          result.details.push(
            'venv module is not available. On Debian/Ubuntu, install it with: sudo apt install python3-venv'
          )
        }
      }
    } catch (e) {
      result.details.push('venv module is not available.')
    }

    // Check pip module (ensurepip)
    try {
      const pipCheck = spawnSync(
        spawnCmd,
        [...spawnArgs, '-c', 'import ensurepip'],
        { shell: useShell, timeout: 10000 }
      )
      if (pipCheck.status === 0) {
        result.pip = true
      } else {
        // Also check if pip itself is available
        const pipDirect = spawnSync(
          spawnCmd,
          [...spawnArgs, '-m', 'pip', '--version'],
          { shell: useShell, timeout: 10000 }
        )
        if (pipDirect.status === 0) {
          result.pip = true
        } else {
          result.details.push(
            'pip is not available.' +
              (process.platform === 'win32'
                ? ' Please install Python from https://www.python.org/ and ensure pip is included.'
                : ' On Debian/Ubuntu, install it with: sudo apt install python3-pip')
          )
        }
      }
    } catch (e) {
      result.details.push('pip is not available.')
    }

    return result
  }

  function venvConfig(config) {
    RED.nodes.createNode(this, config)
    this.venvname = config.venvname
    this.version = config.version
    const node = this

    const setupPath = path.join(path.dirname(__dirname), 'setup.py')
    let venvPath = path.join(path.dirname(__dirname), this.venvname)

    // Check environment before attempting to create venv
    const envCheck = checkPythonEnvironment(this.version)

    if (!envCheck.python) {
      node.warn(
        'Python is not installed or not found in PATH. Virtual environment cannot be created.'
      )
      return
    }

    if (!envCheck.venv) {
      if (process.platform === 'win32') {
        node.warn(
          'Python venv module is not available. Please install Python from https://www.python.org/ (not the Microsoft Store version).'
        )
      } else {
        node.warn(
          'Python venv module is not installed. On Debian/Ubuntu, run: sudo apt install python3-venv'
        )
      }
    }

    if (!envCheck.pip) {
      if (process.platform === 'win32') {
        node.warn(
          'Python pip is not available. Please install Python from https://www.python.org/ and ensure pip is included.'
        )
      } else {
        node.warn(
          'Python pip is not available. On Debian/Ubuntu, run: sudo apt install python3-pip python3-venv'
        )
      }
    }

    if (envCheck.venv) {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
      let command = `${pythonCmd} ${setupPath} "${this.venvname}"`
      if (
        typeof this.version !== 'undefined' &&
        this.version !== '' &&
        this.version !== 'default'
      ) {
        command += ` ${this.version}`
      }
      try {
        execSync(command)
      } catch (e) {
        node.warn(`Failed to create virtual environment: ${e.message}`)
      }
    }

    this.on('close', function (removed, done) {
      if (removed) {
        fs.rmSync(venvPath, { recursive: true, force: true })
      }
      done()
    })
  }

  RED.httpAdmin.get(
    '/venvconfig/path',
    RED.auth.needsPermission('venvconfig.read'),
    function (req, res) {
      const venvname = req.query.venvname

      let absolutePath
      if (path.isAbsolute(venvname)) {
        absolutePath = venvname
      } else {
        absolutePath = path.resolve(
          path.join(path.dirname(path.dirname(__dirname)), venvname)
        )
      }

      res.json({ path: absolutePath })
    }
  )

  RED.httpAdmin.get(
    '/venvconfig/check',
    RED.auth.needsPermission('venvconfig.read'),
    function (req, res) {
      const version = req.query.version || ''
      const result = checkPythonEnvironment(version)
      res.json(result)
    }
  )

  RED.nodes.registerType('venv-config', venvConfig)
}
