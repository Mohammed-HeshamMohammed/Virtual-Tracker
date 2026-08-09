/** WS connection lifecycle → PresenceService register/unregister. */
export function createPresenceManager(presenceService) {
  return {
    /**
     * @param {string} memberId
     * @param {string} connectionId
     */
    onConnect(memberId, connectionId) {
      presenceService.registerConnection(memberId, connectionId);
    },

    /**
     * @param {string} memberId
     * @param {string} connectionId
     */
    onDisconnect(memberId, connectionId) {
      presenceService.unregisterConnection(memberId, connectionId);
    },
  };
}
