/**
 * Host loader entry for dsh-market — no host-side behavior: the plugin
 * market is browser-only (it talks to the public npm/GitHub APIs straight
 * from the client bundle). The empty plugin keeps the cordis loader entry
 * clean; all behavior lives in `./client`.
 */
export function apply(): void {}
