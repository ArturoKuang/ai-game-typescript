import {
  createGameServerRuntime,
  startGameServer,
} from "./bootstrap/runtime.js";

async function main(): Promise<void> {
  const runtime = await createGameServerRuntime({
    env: process.env,
    moduleUrl: import.meta.url,
  });
  await startGameServer(runtime.server, runtime.port);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
