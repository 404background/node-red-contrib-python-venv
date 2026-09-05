/*
 * Creates the default "pyenv" virtual environment at install time.
 *
 * Python is looked up under every name it commonly has, because "python" does
 * not exist on many Linux distributions and "python3" does not exist on
 * Windows. Failure is never fatal: the venv-config node creates the
 * environment again on deploy, so a missing interpreter must not abort the
 * installation of the node itself.
 */
const path = require('path')
const { spawnSync } = require('child_process')

const SETUP_SCRIPT = path.join(__dirname, '..', 'setup.py')
const DEFAULT_VENV_NAME = 'pyenv'

const CANDIDATES =
  process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ]

function isUsable(candidate) {
  const probe = spawnSync(candidate.command, [...candidate.args, '--version'], {
    encoding: 'utf-8',
    timeout: 15000,
  })
  // A Windows Store stub exits non-zero without printing a version.
  return !probe.error && probe.status === 0
}

const python = CANDIDATES.find(isUsable)

if (!python) {
  console.warn(
    '[node-red-contrib-python-venv] Python was not found in PATH; skipping ' +
      'creation of the default virtual environment. It will be created when ' +
      'you deploy a venv configuration node.'
  )
  process.exit(0)
}

const result = spawnSync(
  python.command,
  [...python.args, SETUP_SCRIPT, DEFAULT_VENV_NAME],
  { stdio: 'inherit' }
)

if (result.error || result.status !== 0) {
  console.warn(
    '[node-red-contrib-python-venv] Could not create the default virtual ' +
      'environment. It will be created when you deploy a venv configuration node.'
  )
}

process.exit(0)
