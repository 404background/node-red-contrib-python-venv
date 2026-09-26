const fs = require('fs')
const path = require('path')

// <package root>/node/lib/venv-paths.js -> <package root>
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..')

const IS_WINDOWS = process.platform === 'win32'

// Written by setup.py into every virtual environment it creates. Only a venv
// carrying this marker is removed when its configuration node is deleted.
const CREATED_MARKER = '.node-red-venv-created'

// The layout `python -m venv` produces. Used for environments without
// path.json (those created outside of Node-RED) and as a fallback when
// path.json is missing an entry or points at a file that no longer exists
// (e.g. the venv was recreated on another platform).
const DEFAULT_RELATIVE_PATHS = IS_WINDOWS
  ? {
      python: 'Scripts/python.exe',
      exec: 'Scripts/',
    }
  : {
      python: 'bin/python',
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

/**
 * Whether a directory is a Python virtual environment made by `venv`.
 * @param {string} venvDir absolute directory
 * @returns {boolean}
 */
function isVirtualEnv(venvDir) {
  return fs.existsSync(path.join(venvDir, 'pyvenv.cfg'))
}

/**
 * Whether this package created the virtual environment, as opposed to one
 * that was created elsewhere and is only used by the nodes.
 * @param {string} venvDir absolute directory
 * @returns {boolean}
 */
function isCreatedByNode(venvDir) {
  return fs.existsSync(path.join(venvDir, CREATED_MARKER))
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
 * Resolve the interpreter and executable-directory paths of a virtual
 * environment. path.json is read when present; an environment created
 * outside of Node-RED has none and uses the standard venv layout.
 * @param {string} venvname configured venv name (relative or absolute)
 * @returns {{venvDir: string, python: string, exec: string}}
 * @throws {Error} when the venv is not ready or path.json is unreadable
 */
function readVenvPaths(venvname) {
  const venvDir = resolveVenvDir(venvname)
  const jsonPath = path.join(venvDir, 'path.json')

  if (!fs.existsSync(jsonPath)) {
    if (!isVirtualEnv(venvDir)) {
      throw new Error(
        `Virtual environment is not ready. pyvenv.cfg not found in ${venvDir}.`
      )
    }
    return {
      venvDir,
      python: resolveEntry(venvDir, null, DEFAULT_RELATIVE_PATHS.python),
      exec: resolveEntry(venvDir, null, DEFAULT_RELATIVE_PATHS.exec),
    }
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
    exec: resolveEntry(
      venvDir,
      parsed.NODE_PYENV_EXEC,
      DEFAULT_RELATIVE_PATHS.exec
    ),
  }
}

module.exports = {
  PACKAGE_ROOT,
  CREATED_MARKER,
  DEFAULT_RELATIVE_PATHS,
  resolveVenvDir,
  isVirtualEnv,
  isCreatedByNode,
  readVenvPaths,
}
