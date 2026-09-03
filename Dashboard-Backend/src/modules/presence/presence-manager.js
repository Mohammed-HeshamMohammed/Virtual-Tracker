export function createPresenceManager(presenceService) {
  return {
    onConnect(memberId, connectionId) {
      presenceService.registerConnection(memberId, connectionId);
    },

    onDisconnect(memberId, connectionId) {
      presenceService.unregisterConnection(memberId, connectionId);
    },
  };
}
