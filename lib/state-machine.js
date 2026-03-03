/**
 * Voilà Pipeline State Machine
 * Pure functions for state transitions - no side effects
 */

// Valid states in the pipeline
const STATES = {
  IMPORTED: 'IMPORTED',
  ENRICHING: 'ENRICHING',
  READY_TO_DRAFT: 'READY_TO_DRAFT',
  DRAFTED: 'DRAFTED',
  PENDING_SEND: 'PENDING_SEND',
  SENT: 'SENT',
  SIMULATED: 'SIMULATED',
  REPLIED: 'REPLIED',
  NO_REPLY: 'NO_REPLY',
  FOLLOW_UP_SCHEDULED: 'FOLLOW_UP_SCHEDULED',
  FAILED: 'FAILED',
  CONVERTED: 'CONVERTED',
  LOST: 'LOST',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
  PAUSED: 'PAUSED'
};

// Valid state transitions (from -> [to, ...])
const TRANSITIONS = {
  IMPORTED: ['ENRICHING', 'READY_TO_DRAFT', 'FAILED'],
  ENRICHING: ['READY_TO_DRAFT', 'FAILED'],
  READY_TO_DRAFT: ['DRAFTED', 'FAILED'],
  DRAFTED: ['PENDING_SEND', 'FAILED'],
  PENDING_SEND: ['SENT', 'SIMULATED', 'FAILED'],
  SENT: ['REPLIED', 'NO_REPLY', 'FAILED'],
  SIMULATED: ['PENDING_SEND', 'FAILED'],
  REPLIED: ['FOLLOW_UP_SCHEDULED', 'CONVERTED', 'LOST'],
  FAILED: ['READY_TO_DRAFT', 'PAUSED'],
  FOLLOW_UP_SCHEDULED: ['SENT', 'CONVERTED', 'LOST'],
  PAUSED: ['READY_TO_DRAFT'],
  NO_REPLY: ['FOLLOW_UP_SCHEDULED', 'LOST'],
  CONVERTED: [],
  LOST: [],
  UNSUBSCRIBED: []
};

/**
 * Check if a transition is valid
 * @param {string} fromState - Current state
 * @param {string} toState - Target state
 * @returns {boolean}
 */
function canTransition(fromState, toState) {
  if (!STATES[fromState]) return false;
  if (!STATES[toState]) return false;
  if (!TRANSITIONS[fromState]) return false;

  return TRANSITIONS[fromState].includes(toState);
}

/**
 * Execute a state transition
 * @param {Object} lead - Current lead object
 * @param {string} toState - Target state
 * @param {Object} metadata - Additional context for the transition
 * @returns {Object} Updated lead object
 */
function transition(lead, toState, metadata = {}) {
  const { fromState, ...transitionMeta } = metadata;

  // Validate transition
  if (!canTransition(lead.state, toState)) {
    throw new Error(`Invalid transition: ${lead.state} -> ${toState}`);
  }

  // Create history entry
  const historyEntry = {
    from: lead.state,
    to: toState,
    timestamp: new Date().toISOString(),
    ...transitionMeta
  };

  // Return updated lead (immutable)
  return {
    ...lead,
    state: toState,
    history: [...(lead.history || []), historyEntry],
    updated_at: new Date().toISOString()
  };
}

/**
 * Check if a state is terminal
 * @param {string} state
 * @returns {boolean}
 */
function isTerminal(state) {
  return [STATES.CONVERTED, STATES.LOST, STATES.UNSUBSCRIBED].includes(state);
}

/**
 * Check if a state allows manual review
 * @param {string} state
 * @returns {boolean}
 */
function requiresManualReview(state) {
  return state === STATES.DRAFTED;
}

/**
 * Get all valid next states for a given state
 * @param {string} state
 * @returns {Array<string>}
 */
function getNextStates(state) {
  return TRANSITIONS[state] || [];
}

module.exports = {
  STATES,
  canTransition,
  transition,
  isTerminal,
  requiresManualReview,
  getNextStates
};
