import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, "../../..");
const servidor = join(raiz, "apps/server");
const dist = join(raiz, "apps/web/dist");
const PORTA = 8099;

function executar(comando: string, args: string[], opcoes: { cwd: string; env?: NodeJS.ProcessEnv; shell?: boolean }): Promise<void> {
  return new Promise((ok, falha) => {
    const filho = spawn(comando, args, { ...opcoes, env: { ...process.env, ...opcoes.env }, stdio: "inherit" });
    filho.on("error", falha);
    filho.on("exit", (codigo) => (codigo === 0 ? ok() : falha(new Error(`${comando} ${args.join(" ")} terminou com código ${codigo}`))));
  });
}

async function esperarServidor(filho: ChildProcess): Promise<void> {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    if (filho.exitCode !== null) throw new Error("O servidor encerrou antes de ficar pronto.");
    try {
      const r = await fetch(`http://localhost:${PORTA}/`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("O servidor não respondeu em 30 s.");
}

/** globalSetup: build da web, banco temporário com a pousada de demonstração e servidor na porta 8099. */
export default async function preparar(): Promise<() => Promise<void>> {
  await executar("npm", ["run", "build", "-w", "apps/web"], { cwd: raiz, shell: true });

  const pasta = mkdtempSync(join(tmpdir(), "erp-e2e-"));
  const env = { ERP_DB: join(pasta, "e2e.db"), ERP_PORTA: String(PORTA), ERP_HOST: "127.0.0.1", ERP_WEB_DIR: dist };
  const tsx = ["--import", "tsx"];
  await executar(process.execPath, [...tsx, "src/demo.ts"], { cwd: servidor, env });

  const filho = spawn(process.execPath, [...tsx, "src/main.ts"], { cwd: servidor, env: { ...process.env, ...env }, stdio: "inherit" });
  try {
    await esperarServidor(filho);
  } catch (erro) {
    filho.kill();
    rmSync(pasta, { recursive: true, force: true });
    throw erro;
  }

  return async () => {
    if (filho.exitCode === null) {
      const saiu = new Promise((r) => filho.once("exit", r));
      filho.kill();
      await saiu;
    }
    if (existsSync(pasta)) rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
}
