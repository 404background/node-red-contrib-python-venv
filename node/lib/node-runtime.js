/**
 * Helpers shared by the runtime side of the venv, pip and venv-exec nodes.
 * They cover the small pieces of boilerplate every node repeats: reporting
 * status, resolving the configured virtual environment, keeping track of the
 * spawned processes and shaping the outgoing messages.
 */

const { readVenvPaths } = require('./venv-paths')

/**
 * Status helper bound to a node and its locale prefix, so that call sites read
 * as `status.key('red', 'error')` instead of repeating shape and prefix.
 * @param {object} node
 * @param {string} prefix locale namespace of the node, e.g. 'venv'
 */
function statusReporter(node, prefix) {
  return {
    /** Show a translated status text. */
    key(fill, key) {
      node.status({ fill, shape: 'dot', text: `${prefix}.${key}` })
    },
    /** Show a literal status text that is composed at runtime. */
    text(fill, text) {
      node.status({ fill, shape: 'dot', text })
    },
    clear() {
      node.status({})
    },
  }
}

/**
 * Resolve the virtual environment a node is configured with. Failures are
 * reported on the node itself, because there is nothing the node can do
 * without a usable environment.
 * @param {object} RED
 * @param {object} node
 * @param {object} config
 * @param {{key: (fill: string, key: string) => void}} status
 * @returns {{venvDir: string, python: string, pip: string, exec: string}|null}
 */
function resolveVenvForNode(RED, node, config, status) {
  node.venvconfig = RED.nodes.getNode(config.venvconfig)
  if (!node.venvconfig) {
    status.key('red', 'error')
    node.error('Missing virtual environment configuration')
    return null
  }

  try {
    return readVenvPaths(node.venvconfig.venvname)
  } catch (e) {
    status.key('red', 'error')
    node.error(e.message)
    return null
  }
}

/**
 * Node-RED 0.x does not hand a `send` to the input handler.
 * @param {object} node
 * @param {Function} [send]
 * @returns {Function}
 */
function legacySend(node, send) {
  return send || node.send.bind(node)
}

/**
 * Node-RED 0.x does not hand a `done` to the input handler, so errors have to
 * be reported through `node.error` instead.
 * @param {object} node
 * @param {object} msg
 * @param {Function} [done]
 * @returns {Function}
 */
function legacyDone(node, msg, done) {
  return (
    done ||
    function (err) {
      if (err) {
        node.error(err, msg)
      }
    }
  )
}

/**
 * Wrap a function so that only the first call gets through. Used where both
 * 'error' and 'close' can fire but only one of them may complete the message.
 * @param {Function} fn
 * @returns {Function}
 */
function callOnce(fn) {
  let called = false
  return function (...args) {
    if (called) {
      return undefined
    }
    called = true
    return fn(...args)
  }
}

/**
 * Build a function that clones the incoming message and puts `payload` on it,
 * so that each output gets an independent message.
 * @param {object} RED
 * @param {object} msg
 * @returns {(payload: unknown) => object}
 */
function messageDeriver(RED, msg) {
  return payload => {
    const copy = RED.util.cloneMessage(msg)
    copy.payload = payload
    return copy
  }
}

/**
 * Payload of the return code output, shaped like the core exec node.
 * @param {number|null} code
 * @param {string|null} signal
 * @returns {{code: number|null, signal?: string}}
 */
function describeExit(code, signal) {
  const payload = { code }
  if (signal !== null && typeof signal !== 'undefined') {
    payload.signal = signal
  }
  return payload
}

/**
 * Prefer the value configured in the editor and fall back to the payload of
 * the incoming message.
 * @param {unknown} configured
 * @param {unknown} payload
 * @returns {string} '' when neither carries a value
 */
function pickArgument(configured, payload) {
  if (typeof configured !== 'undefined' && configured !== '') {
    return String(configured)
  }
  if (typeof payload !== 'undefined' && payload !== '') {
    return String(payload)
  }
  return ''
}

/**
 * Collect the child processes a node spawns and kill whatever is still running
 * when the node is stopped.
 * @param {object} node
 * @param {(child: object) => void} [beforeKill] runs on each process first
 * @returns {Set<object>} set the node adds its spawned processes to
 */
function trackChildProcesses(node, beforeKill) {
  const active = new Set()

  node.on('close', function (_removed, done) {
    killAll(active, beforeKill)
    done()
  })

  return active
}

/**
 * Kill every tracked process, marking it first when a marker is given.
 * @param {Set<object>} active
 * @param {(child: object) => void} [beforeKill]
 */
function killAll(active, beforeKill) {
  for (const child of active) {
    if (beforeKill) {
      beforeKill(child)
    }
    child.kill()
  }
  active.clear()
}

module.exports = {
  statusReporter,
  resolveVenvForNode,
  legacySend,
  legacyDone,
  callOnce,
  messageDeriver,
  describeExit,
  pickArgument,
  trackChildProcesses,
  killAll,
}
