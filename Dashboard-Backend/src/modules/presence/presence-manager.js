/**
 * Connection lifecycle bridge between WebSocket gateway and PresenceService.
 *
 * @param {ReturnType<import("./presence-service.js").createPresenceService>} presenceService
 */
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
