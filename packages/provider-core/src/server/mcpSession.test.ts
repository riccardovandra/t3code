import { describe, expect, it } from "vite-plus/test";
import { upstreamServersFor, withAgentDeviceEnvironment } from "./mcpSession.ts";

describe("device CLI environment", () => {
  it("preserves provider credentials and commands while routing devices to the owned daemon", () => {
    const environment = withAgentDeviceEnvironment(
      { PATH: "/provider/bin:/usr/bin", PROVIDER_KEY: "fixture" },
      {
        agentDeviceEnvironment: {
          PATH: "/t3/device/bin",
          PATH_SEPARATOR: ":",
          AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
          AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
        },
      },
    );
    expect(environment).toEqual({
      PATH: "/t3/device/bin:/provider/bin:/usr/bin",
      PROVIDER_KEY: "fixture",
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
    });
  });

  it("does not grant CLI access when device access was not supplied", () => {
    const environment = { PATH: "/usr/bin", PROVIDER_KEY: "fixture" };
    expect(withAgentDeviceEnvironment(environment, undefined)).toBe(environment);
    expect(withAgentDeviceEnvironment(environment, {})).toBe(environment);
  });
});

describe("configured MCP servers", () => {
  const config = {
    upstreamServers: [{ name: "notion", endpoint: "http://127.0.0.1:1/mcp/upstream/notion-id" }],
  };

  it("offers them to sessions that can write", () => {
    expect(upstreamServersFor(config, { sandboxPolicy: { type: "workspaceWrite" } })).toEqual(
      config.upstreamServers,
    );
    expect(upstreamServersFor(config, undefined)).toEqual(config.upstreamServers);
  });

  it("withholds them from read-only sandboxes", () => {
    expect(upstreamServersFor(config, { sandboxPolicy: { type: "readOnly" } })).toEqual([]);
  });
});
