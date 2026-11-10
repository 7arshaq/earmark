// Starts the server with demo links enabled: paste  demo:Any Title|seconds  to test the whole flow offline.
process.env.EARMARK_DEMO = '1';
await import('../server.mjs');
