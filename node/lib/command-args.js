const path = require('path')

/**
 * Split a command line into arguments, honouring single and double quotes.
 * Quotes group whitespace and are removed from the resulting argument, which
 * lets a value contain spaces without a shell being involved.
 * @param {string} input
 * @returns {string[]}
 */
function parseArguments(input) {
  const args = []
  let current = ''
  let started = false
  let quote = null

  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
    } else {
      current += ch
      started = true
    }
  }
  if (started) {
    args.push(current)
  }
  return args
}

/**
 * Split a whitespace separated argument string, dropping empty parts.
 * @param {string} argument
 * @returns {string[]}
 */
function splitPackageNames(argument) {
  return argument.split(/\s+/).filter(part => part !== '')
}

/**
 * Resolve an executable inside a directory, refusing paths that escape it.
 * @param {string} execDir directory the executable must live in
 * @param {string} executable file name, possibly with sub directories
 * @returns {string} absolute path to the executable
 * @throws {Error} when the executable would resolve outside execDir
 */
function resolveExecutable(execDir, executable) {
  const base = path.resolve(execDir)
  const resolved = path.resolve(base, executable)
  const relative = path.relative(base, resolved)
  if (
    relative === '' ||
    relative.startsWith('..') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Executable must be located inside ${base} (got: ${executable})`
    )
  }
  return resolved
}

module.exports = {
  parseArguments,
  splitPackageNames,
  resolveExecutable,
}
