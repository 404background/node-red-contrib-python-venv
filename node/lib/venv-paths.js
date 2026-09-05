const fs = require('fs')
const path = require('path')

// <package root>/node/lib/venv-paths.js -> <package root>
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

const IS_WINDOWS = process.platform === 'win32'

// Fallbacks used when path.json is missing an entry or points at a file that
// no longer exists (e.g. the venv was recreated on another platform).
const DEFAULT_RELATIVE_PATHS = IS_WINDOWS
  ? {
      python: 'Scripts/python.exe',
      pip: 'Scripts/pip.exe',
      exec: 'Scripts/',
    }
  : {
      python: 'bin/python',
      pip: 'bin/pip',
      exec: 'bin/',
    }

/**
 * Absolute directory of a virtual environment. Relative names are resolved
 * against the package root, which is where setup.py creates them.
 * @param {string} venvname
 * @returns {string}
 */
function resolveVenvDir(venvname) {
  if (typeof venvname !== 'string' || venvname.trim() === '') {
    throw new Error('Virtual environment name is not configured.')
  }
  return path.isAbsolute(venvname)
    ? path.resolve(venvname)
    : path.resolve(PACKAGE_ROOT, venvname)
}

function resolveEntry(venvDir, rawValue, defaultRelative) {
  if (typeof rawValue === 'string' && rawValue !== '') {
    const resolved = path.normalize(
      path.isAbsolute(rawValue) ? rawValue : path.join(venvDir, rawValue)
    )
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }
  return path.normalize(path.join(venvDir, defaultRelative))
}

/**
 * Read path.json of a virtual environment and resolve the interpreter,
 * pip and executable-directory paths.
 * @param {string} venvname configured venv name (relative or absolute)
 * @returns {{venvDir: string, python: string, pip: string, exec: string}}
 * @throws {Error} when the venv is not ready or path.json is unreadable
 */
function readVenvPaths(venvname) {
  const venvDir = resolveVenvDir(venvname)
  const jsonPath = path.join(venvDir, 'path.json')

  if (!fs.existsSync(jsonPath)) {
    throw new Error('Virtual environment is not ready. path.json not found.')
  }

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  } catch (e) {
    throw new Error(`Failed to read ${jsonPath}: ${e.message}`)
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(`Failed to read ${jsonPath}: unexpected content.`)
  }

  return {
    venvDir,
    python: resolveEntry(
      venvDir,
      parsed.NODE_PYENV_PYTHON,
      DEFAULT_RELATIVE_PATHS.python
    ),
    pip: resolveEntry(
      venvDir,
      parsed.NODE_PYENV_PIP,
      DEFAULT_RELATIVE_PATHS.pip
    ),
    exec: resolveEntry(
      venvDir,
      parsed.NODE_PYENV_EXEC,
      DEFAULT_RELATIVE_PATHS.exec
    ),
  }
}

module.exports = {
  PACKAGE_ROOT,
  DEFAULT_RELATIVE_PATHS,
  resolveVenvDir,
  readVenvPaths,
}
