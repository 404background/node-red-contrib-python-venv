const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const {
  PACKAGE_ROOT,
  CREATED_MARKER,
  resolveVenvDir,
  isVirtualEnv,
  isCreatedByNode,
} = require('./lib/venv-paths')
const { normalizePythonVersion } = require('./lib/command-args')

const SETUP_SCRIPT = path.join(PACKAGE_ROOT, 'setup.py')

// setup.py runs in the background and outlives a redeploy. Keyed by venv
// path, so the configuration node started by the next deploy waits for the
// same run instead of starting a second one on the same folder.
const pendingSetups = new Map()
const COMMAND_TIMEOUT_MS = 10000

// Files and directories a virtual environment created by this node may contain.
// Only these are removed on cleanup so that unrelated user files are preserved.
const VENV_ENTRIES = [
  'Scripts',
  'bin',
  'Lib',
  'lib',
  'lib64',
  'Include',
  'include',
  'share',
  'Temp',
  'pyvenv.cfg',
  'path.json',
  CREATED_MARKER,
  '.gitignore',
]

// Script files written by venv nodes: "<name>-<node id>.py"
const NODE_SCRIPT_FILE = /^.+-[0-9a-f]{8,}\.py$/

/**
 * Resolve the interpreter used to create the virtual environment.
 * @param {string} version optional Python version ('' or 'default' for none)
 * @returns {{command: string, args: string[], label: string}}
 */
function resolvePythonLauncher(version) {
  const hasVersion =
    typeof version === 'string' && version !== '' && version !== 'default'

  if (process.platform === 'win32') {
    if (hasVersion) {
      // The Windows launcher selects the requested interpreter version.
      return { command: 'py', args: [`-${version}`], label: `py -${version}` }
    }
    return { command: 'python', args: [], label: 'python' }
  }
  if (hasVersion) {
    // There is no launcher on POSIX, so a version maps to the versioned
    // interpreter name. setup.py falls back the same way when it is missing.
    return {
      command: `python${version}`,
      args: [],
      label: `python${version}`,
      versioned: true,
    }
  }
  return { command: 'python3', args: [], label: 'python3' }
}

/**
 * Check if python, the venv module and pip are available.
 * @param {string} version
 * @returns {{python: boolean, venv: boolean, pip: boolean, pythonCmd: string, details: string[]}}
 */
function checkPythonEnvironment(version) {
  const result = {
    python: false,
    venv: false,
    pip: false,
    pythonCmd: '',
    details: [],
  }

  // The version becomes part of a command line run through a shell, so only a
  // well formed one gets that far.
  const normalized = normalizePythonVersion(version)
  if (normalized === null) {
    result.details.push(`Invalid Python version: ${String(version)}`)
    return result
  }

  let launcher = resolvePythonLauncher(normalized)

  // On Windows, avoid shell: true to prevent cmd.exe from splitting -c arguments on spaces.
  // On Linux/macOS, use shell: true so PATH is resolved correctly (e.g. when running as a service).
  const useShell = process.platform !== 'win32'
  // When using a shell, wrap -c code in double quotes to prevent word splitting
  const shellQuote = code => (useShell ? `"${code}"` : code)

  const run = extraArgs => {
    try {
      return spawnSync(launcher.command, [...launcher.args, ...extraArgs], {
        shell: useShell,
        timeout: COMMAND_TIMEOUT_MS,
      })
    } catch (_e) {
      return null
    }
  }

  let versionCheck = run(['--version'])
  if ((!versionCheck || versionCheck.status !== 0) && launcher.versioned) {
    // Report the same fallback setup.py performs rather than claiming that
    // Python is missing altogether.
    result.details.push(
      `${launcher.label} was not found. The default interpreter will be used instead.`
    )
    launcher = resolvePythonLauncher('')
    versionCheck = run(['--version'])
  }
  result.pythonCmd = launcher.label

  if (!versionCheck || versionCheck.status !== 0) {
    result.details.push(`Python not found (command: ${launcher.label})`)
    return result
  }
  result.python = true
  result.details.push(String(versionCheck.stdout || '').trim())

  const venvCheck = run(['-c', shellQuote('import venv, ensurepip')])
  if (venvCheck && venvCheck.status === 0) {
    result.venv = true
  } else if (process.platform === 'win32') {
    result.details.push(
      'venv module is not available. Please install Python from https://www.python.org/ (not the Microsoft Store version).'
    )
  } else {
    result.details.push(
      'venv module is not available. On Debian/Ubuntu, install it with: sudo apt install python3-venv'
    )
  }

  const pipCheck = run(['-c', shellQuote('import ensurepip')])
  if (pipCheck && pipCheck.status === 0) {
    result.pip = true
  } else {
    result.details.push(
      'pip is not available.' +
        (process.platform === 'win32'
          ? ' Please install Python from https://www.python.org/ and ensure pip is included.'
          : ' On Debian/Ubuntu, install it with: sudo apt install python3-pip')
    )
  }

  return result
}

/**
 * Remove a virtual environment that this node created, entry by entry.
 * Unknown files are left untouched and the directory itself is only removed
 * once it is empty.
 * @param {string} venvPath
 */
function removeCreatedVenv(venvPath) {
  for (const entry of VENV_ENTRIES) {
    const entryPath = path.join(venvPath, entry)
    if (fs.existsSync(entryPath)) {
      fs.rmSync(entryPath, { recursive: true, force: true })
    }
  }

  // Remove .py script files created by venv nodes (filename contains a node ID)
  try {
    for (const file of fs.readdirSync(venvPath)) {
      if (NODE_SCRIPT_FILE.test(file)) {
        fs.rmSync(path.join(venvPath, file), { force: true })
      }
    }
  } catch (_e) {
    // Directory already gone or unreadable
  }

  // Remove the venv directory only if it is now empty
  try {
    fs.rmdirSync(venvPath)
  } catch (_e) {
    // Directory not empty - leave it as is
  }
}

module.exports = function (RED) {
  function venvConfig(config) {
    RED.nodes.createNode(this, config)
    this.venvname = config.venvname
    this.version = config.version
    const node = this

    if (
      typeof this.venvname !== 'string' ||
      this.venvname.trim() === '' ||
      this.venvname === 'undefined'
    ) {
      node.warn('Invalid venv name. Virtual environment will not be created.')
      return
    }

    const version = normalizePythonVersion(this.version)
    if (version === null) {
      node.warn(
        `Invalid Python version "${this.version}". Use a version such as 3 or 3.11.`
      )
      return
    }

    const venvPath = resolveVenvDir(this.venvname)

    this.on('close', function (removed, done) {
      // A redeploy lets a running setup finish; deleting the node stops it.
      const pending = pendingSetups.get(venvPath)
      if (removed && pending) {
        pending.child.kill()
        pendingSetups.delete(venvPath)
      }
      // Only an environment this node created is removed; one created
      // outside of Node-RED has no marker and is always left alone.
      if (removed && isCreatedByNode(venvPath) && isVirtualEnv(venvPath)) {
        // Refuse to touch a filesystem root or a top level directory.
        const depth = venvPath.split(path.sep).filter(Boolean).length
        if (depth >= 2) {
          try {
            removeCreatedVenv(venvPath)
          } catch (e) {
            node.warn(`Failed to remove virtual environment: ${e.message}`)
          }
        }
      }
      done()
    })

    // An existing virtual environment, created by this node earlier or
    // outside of Node-RED, is used as it is. Neither the system Python nor
    // its venv module is needed for that.
    if (isVirtualEnv(venvPath) && !pendingSetups.has(venvPath)) {
      return
    }

    // Still being created by the previous deploy.
    if (pendingSetups.has(venvPath)) {
      this.ready = pendingSetups.get(venvPath).ready
      return
    }

    // Check environment before attempting to create venv
    const envCheck = checkPythonEnvironment(version)

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
      // setup.py is always run with the default interpreter; it applies the
      // requested version itself through the Windows launcher.
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
      const args = [SETUP_SCRIPT, this.venvname]
      if (version !== '') {
        args.push(version)
      }

      // Creating the environment and upgrading pip can take minutes. It runs
      // in the background so that the deploy (and the whole runtime) is not
      // blocked; the venv, pip and venv-exec nodes wait for `ready`.
      // Arguments are passed as an array so that spaces in the package path or
      // in the venv name cannot be reinterpreted by a shell.
      let child
      const ready = new Promise(resolve => {
        let stderr = ''
        child = spawn(pythonCmd, args)
        child.stdout.on('data', () => {})
        child.stderr.on('data', chunk => {
          stderr += chunk.toString('utf8')
        })
        // 'error' and 'close' can both fire; only the first one settles.
        let settled = false
        const settle = message => {
          if (settled) {
            return
          }
          settled = true
          if (pendingSetups.get(venvPath)?.child === child) {
            pendingSetups.delete(venvPath)
          }
          if (message) {
            node.warn(message)
          }
          resolve()
        }
        child.on('error', err => {
          settle(`Failed to create virtual environment: ${err.message}`)
        })
        child.on('close', (code, signal) => {
          // A signal means the node was deleted, which is not a failure.
          if (code === 0 || signal !== null) {
            settle()
          } else {
            const detail = stderr.trim()
            settle(
              `Failed to create virtual environment (exit code ${code})` +
                (detail === '' ? '' : `: ${detail}`)
            )
          }
        })
      })
      pendingSetups.set(venvPath, { child, ready })
      this.ready = ready
    }
  }

  RED.httpAdmin.get(
    '/venvconfig/path',
    RED.auth.needsPermission('venvconfig.read'),
    function (req, res) {
      const venvname = req.query.venvname
      let absolutePath
      try {
        // Same resolution as the runtime, so the editor shows the real location.
        absolutePath = resolveVenvDir(venvname)
      } catch (e) {
        res.status(400).json({ error: e.message })
        return
      }
      res.json({
        path: absolutePath,
        // Tells the editor whether deleting the node removes the folder.
        created: isCreatedByNode(absolutePath) && isVirtualEnv(absolutePath),
      })
    }
  )

  RED.httpAdmin.get(
    '/venvconfig/check',
    RED.auth.needsPermission('venvconfig.read'),
    function (req, res) {
      const version = req.query.version || ''
      if (normalizePythonVersion(version) === null) {
        res.status(400).json({ error: 'Invalid Python version' })
        return
      }
      res.json(checkPythonEnvironment(version))
    }
  )

  RED.nodes.registerType('venv-config', venvConfig)
}
