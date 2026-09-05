/**
 * Helpers for handing msg / flow / global data to a Python process and reading
 * the mutated values back.
 */

// Characters that are illegal or awkward in file names on the supported platforms.
const ILLEGAL_FILENAME_CHARS = /[\\/:"'*?<>|()]+/g
const MAX_BASENAME_LENGTH = 64

// Recognises `node['flow']` / `node["global"]` accesses in user code.
const FLOW_CONTEXT_PATTERN = /node\[['"]flow['"]\]/
const GLOBAL_CONTEXT_PATTERN = /node\[['"]global['"]\]/

/**
 * Turn a node name into a safe file name fragment.
 * @param {string} str
 * @returns {string} sanitized fragment, or '' when nothing usable remains
 */
function sanitizeBaseName(str) {
  return str
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .slice(0, MAX_BASENAME_LENGTH)
    .replace(/[. ]+$/, '') // Windows rejects trailing dots and spaces
    .trim()
}

/** @param {string} code @returns {boolean} */
function usesFlowContext(code) {
  return FLOW_CONTEXT_PATTERN.test(code)
}

/** @param {string} code @returns {boolean} */
function usesGlobalContext(code) {
  return GLOBAL_CONTEXT_PATTERN.test(code)
}

/**
 * JSON.stringify that tolerates circular references instead of throwing.
 * @param {unknown} obj
 * @returns {string}
 */
function stringifyWithoutCircularReferences(obj) {
  const seen = new WeakSet()
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined // Skip circular references
      }
      seen.add(value)
    }
    return value
  })
}

/**
 * Snapshot a Node-RED context store as a plain object.
 * @param {{keys: () => string[], get: (k: string) => unknown}} context
 * @returns {Record<string, unknown>}
 */
function readContext(context) {
  return context.keys().reduce((obj, key) => {
    obj[key] = context.get(key)
    return obj
  }, {})
}

/**
 * Write back only the keys whose value actually changed, so that values set by
 * other nodes while the script was running are not overwritten.
 * @param {{set: (k: string, v: unknown) => void}} context
 * @param {Record<string, unknown>} updated
 * @param {Record<string, unknown>} original
 */
function writeChangedContext(context, updated, original) {
  for (const [key, value] of Object.entries(updated)) {
    if (JSON.stringify(value) !== JSON.stringify(original[key])) {
      context.set(key, value)
    }
  }
}

/**
 * Build the bootstrap program run by the interpreter. It loads msg/flow/global
 * from the files listed in the NODE_RED_VENV_IO environment variable, runs the
 * user script and writes the mutated objects back.
 *
 * Paths travel through the environment rather than the source text, so quotes,
 * backslashes and non-ASCII characters in them cannot break the program.
 *
 * @param {boolean} withFlow include flow context handling
 * @param {boolean} withGlobal include global context handling
 * @returns {string} Python source
 */
function buildBootstrapScript(withFlow, withGlobal) {
  const lines = [
    'import json as _nr_json, os as _nr_os',
    "_nr_io = _nr_json.loads(_nr_os.environ['NODE_RED_VENV_IO'])",
    "with open(_nr_io['msg'], 'r', encoding='utf-8') as _nr_f:",
    '    msg = _nr_json.load(_nr_f)',
    "node = {'flow': {}, 'global': {}}",
  ]

  if (withFlow) {
    lines.push(
      "if _nr_io.get('flow'):",
      "    with open(_nr_io['flow'], 'r', encoding='utf-8') as _nr_f:",
      "        node['flow'] = _nr_json.load(_nr_f)"
    )
  }
  if (withGlobal) {
    lines.push(
      "if _nr_io.get('global'):",
      "    with open(_nr_io['global'], 'r', encoding='utf-8') as _nr_f:",
      "        node['global'] = _nr_json.load(_nr_f)"
    )
  }

  // compile() with the real file name keeps tracebacks pointing at the script.
  lines.push(
    "with open(_nr_io['script'], 'r', encoding='utf-8') as _nr_f:",
    '    _nr_source = _nr_f.read()',
    "exec(compile(_nr_source, _nr_io['script'], 'exec'))",
    '',
    'def _nr_write_back(_nr_key, _nr_value):',
    '    try:',
    "        with open(_nr_io[_nr_key], 'w', encoding='utf-8') as _nr_out:",
    '            _nr_json.dump(_nr_value, _nr_out, default=str)',
    '    except Exception:',
    '        pass',
    '',
    "_nr_write_back('msgOut', msg)"
  )

  if (withFlow) {
    lines.push("_nr_write_back('flowOut', node['flow'])")
  }
  if (withGlobal) {
    lines.push("_nr_write_back('globalOut', node['global'])")
  }

  return lines.join('\n') + '\n'
}

module.exports = {
  sanitizeBaseName,
  usesFlowContext,
  usesGlobalContext,
  stringifyWithoutCircularReferences,
  readContext,
  writeChangedContext,
  buildBootstrapScript,
}
