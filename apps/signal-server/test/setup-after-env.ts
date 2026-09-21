import { installNetworkGuard } from './network-guard';

// BUG-008: fail the spec file that tried to reach the network, even when the code under test
// swallowed the refused connection (an adapter's retry loop, a logged fetch error).
const guard = installNetworkGuard();
let seen = 0;

beforeAll(() => {
  seen = guard.blocked.length;
});

afterAll(() => {
  expect({ blockedConnections: guard.blocked.slice(seen) }).toEqual({ blockedConnections: [] });
});
