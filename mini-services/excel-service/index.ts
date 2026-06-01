import { spawn } from "child_process";

const pythonProcess = spawn("python3", ["app.py"], {
  cwd: import.meta.dir,
  stdio: "inherit",
  env: { ...process.env, PORT: "3031" }
});

pythonProcess.on("error", (err) => {
  console.error("Failed to start Python service:", err);
});

process.on("SIGTERM", () => {
  pythonProcess.kill();
  process.exit(0);
});
